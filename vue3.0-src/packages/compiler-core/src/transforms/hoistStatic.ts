import {
  ConstantTypes,
  RootNode,
  NodeTypes,
  TemplateChildNode,
  SimpleExpressionNode,
  ElementTypes,
  PlainElementNode,
  ComponentNode,
  TemplateNode,
  VNodeCall,
  ParentNode
} from '../ast'
import { TransformContext } from '../transform'
import { PatchFlags, isString, isSymbol } from '@vue/shared'
import { isSlotOutlet } from '../utils'
import { CREATE_VNODE } from '../runtimeHelpers'

export function hoistStatic(root: RootNode, context: TransformContext) {
  walk(
    root,
    context,
    // Root node is unfortunately non-hoistable due to potential parent
    // fallthrough attributes.
    isSingleElementRoot(root, root.children[0])
  )
}

export function isSingleElementRoot(
  root: RootNode,
  child: TemplateChildNode
): child is PlainElementNode | ComponentNode | TemplateNode {
  const { children } = root
  return (
    children.length === 1 &&
    child.type === NodeTypes.ELEMENT &&
    !isSlotOutlet(child)
  )
}

function walk(
  node: ParentNode,
  context: TransformContext,
  doNotHoistNode: boolean = false
) {
  let hasHoistedNode = false
  // Some transforms, e.g. transformAssetUrls from @vue/compiler-sfc, replaces
  // static bindings with expressions. These expressions are guaranteed to be
  // constant so they are still eligible for hoisting, but they are only
  // available at runtime and therefore cannot be evaluated ahead of time.
  // This is only a concern for pre-stringification (via transformHoist by
  // @vue/compiler-dom), but doing it here allows us to perform only one full
  // walk of the AST and allow `stringifyStatic` to stop walking as soon as its
  // stringficiation threshold is met.
  /**
   * 
    有些转换，例如@vue/compiler-sfc中的transformAssetUrls，用表达式替换静态绑定。
    这些表达式保证是常量，因此它们仍然可以被提升，但它们仅在运行时可用，因此不能提前计算。

    这只是一个关于预字符串化的问题（通过transformHoist by@vue/compiler-dom),
    但在这里这样做只允许我们执行AST的一次完整遍历,
    并允许“stringifyStatic”在满足字符串分割阈值后立即停止遍历。

   */
  let canStringify = true

  const { children } = node
  for (let i = 0; i < children.length; i++) {
    const child = children[i]
    // only plain elements & text calls are eligible for hoisting.
    // 只有真实的元素或者纯文本才会进行提升
    if (
      child.type === NodeTypes.ELEMENT &&
      child.tagType === ElementTypes.ELEMENT
    ) {
      const constantType = doNotHoistNode
        ? ConstantTypes.NOT_CONSTANT
        : getConstantType(child, context)
      if (constantType > ConstantTypes.NOT_CONSTANT) {
        if (constantType < ConstantTypes.CAN_STRINGIFY) {
          canStringify = false
        }
        if (constantType >= ConstantTypes.CAN_HOIST) {
          ;(child.codegenNode as VNodeCall).patchFlag =
            PatchFlags.HOISTED + (__DEV__ ? ` /* HOISTED */` : ``)
          child.codegenNode = context.hoist(child.codegenNode!)
          hasHoistedNode = true
          continue
        }
      } else {
        // node may contain dynamic children, but its props may be eligible for
        // hoisting.
        const codegenNode = child.codegenNode!
        if (codegenNode.type === NodeTypes.VNODE_CALL) {
          const flag = getPatchFlag(codegenNode)
          if (
            (!flag ||
              flag === PatchFlags.NEED_PATCH ||
              flag === PatchFlags.TEXT) &&
            getGeneratedPropsConstantType(child, context) >=
              ConstantTypes.CAN_HOIST
          ) {
            const props = getNodeProps(child)
            if (props) {
              codegenNode.props = context.hoist(props)
            }
          }
        }
      }
    } else if (child.type === NodeTypes.TEXT_CALL) {
      const contentType = getConstantType(child.content, context)
      if (contentType > 0) {
        if (contentType < ConstantTypes.CAN_STRINGIFY) {
          canStringify = false
        }
        if (contentType >= ConstantTypes.CAN_HOIST) {
          child.codegenNode = context.hoist(child.codegenNode)
          hasHoistedNode = true
        }
      }
    }

    // walk further
    if (child.type === NodeTypes.ELEMENT) {
      walk(child, context)
    } else if (child.type === NodeTypes.FOR) {
      // Do not hoist v-for single child because it has to be a block
      walk(child, context, child.children.length === 1)
    } else if (child.type === NodeTypes.IF) {
      for (let i = 0; i < child.branches.length; i++) {
        // Do not hoist v-if single child because it has to be a block
        walk(
          child.branches[i],
          context,
          child.branches[i].children.length === 1
        )
      }
    }
  }

  if (canStringify && hasHoistedNode && context.transformHoist) {
    context.transformHoist(children, context, node)
  }
}

export function getConstantType(
  node: TemplateChildNode | SimpleExpressionNode,
  context: TransformContext
): ConstantTypes {
  const { constantCache } = context
  switch (node.type) {
    case NodeTypes.ELEMENT:
      if (node.tagType !== ElementTypes.ELEMENT) {
        return ConstantTypes.NOT_CONSTANT
      }
      const cached = constantCache.get(node)
      if (cached !== undefined) {
        return cached
      }
      const codegenNode = node.codegenNode!
      if (codegenNode.type !== NodeTypes.VNODE_CALL) {
        return ConstantTypes.NOT_CONSTANT
      }
      const flag = getPatchFlag(codegenNode)
      if (!flag) {
        let returnType = ConstantTypes.CAN_STRINGIFY

        // Element itself has no patch flag. However we still need to check:

        // 1. Even for a node with no patch flag, it is possible for it to contain
        // non-hoistable expressions that refers to scope variables, e.g. compiler
        // injected keys or cached event handlers. Therefore we need to always
        // check the codegenNode's props to be sure.
        const generatedPropsType = getGeneratedPropsConstantType(node, context)
        if (generatedPropsType === ConstantTypes.NOT_CONSTANT) {
          constantCache.set(node, ConstantTypes.NOT_CONSTANT)
          return ConstantTypes.NOT_CONSTANT
        }
        if (generatedPropsType < returnType) {
          returnType = generatedPropsType
        }

        // 2. its children.
        for (let i = 0; i < node.children.length; i++) {
          const childType = getConstantType(node.children[i], context)
          if (childType === ConstantTypes.NOT_CONSTANT) {
            constantCache.set(node, ConstantTypes.NOT_CONSTANT)
            return ConstantTypes.NOT_CONSTANT
          }
          if (childType < returnType) {
            returnType = childType
          }
        }

        // 3. if the type is not already CAN_SKIP_PATCH which is the lowest non-0
        // type, check if any of the props can cause the type to be lowered
        // we can skip can_patch because it's guaranteed by the absence of a
        // patchFlag.
        if (returnType > ConstantTypes.CAN_SKIP_PATCH) {
          for (let i = 0; i < node.props.length; i++) {
            const p = node.props[i]
            if (p.type === NodeTypes.DIRECTIVE && p.name === 'bind' && p.exp) {
              const expType = getConstantType(p.exp, context)
              if (expType === ConstantTypes.NOT_CONSTANT) {
                constantCache.set(node, ConstantTypes.NOT_CONSTANT)
                return ConstantTypes.NOT_CONSTANT
              }
              if (expType < returnType) {
                returnType = expType
              }
            }
          }
        }

        // only svg/foreignObject could be block here, however if they are
        // static then they don't need to be blocks since there will be no
        // nested updates.
        if (codegenNode.isBlock) {
          codegenNode.isBlock = false
          context.helper(CREATE_VNODE)
        }

        constantCache.set(node, returnType)
        return returnType
      } else {
        constantCache.set(node, ConstantTypes.NOT_CONSTANT)
        return ConstantTypes.NOT_CONSTANT
      }
    case NodeTypes.TEXT:
    case NodeTypes.COMMENT:
      return ConstantTypes.CAN_STRINGIFY
    case NodeTypes.IF:
    case NodeTypes.FOR:
    case NodeTypes.IF_BRANCH:
      return ConstantTypes.NOT_CONSTANT
    case NodeTypes.INTERPOLATION:
    case NodeTypes.TEXT_CALL:
      return getConstantType(node.content, context)
    case NodeTypes.SIMPLE_EXPRESSION:
      return node.constType
    case NodeTypes.COMPOUND_EXPRESSION:
      let returnType = ConstantTypes.CAN_STRINGIFY
      for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i]
        if (isString(child) || isSymbol(child)) {
          continue
        }
        const childType = getConstantType(child, context)
        if (childType === ConstantTypes.NOT_CONSTANT) {
          return ConstantTypes.NOT_CONSTANT
        } else if (childType < returnType) {
          returnType = childType
        }
      }
      return returnType
    default:
      if (__DEV__) {
        const exhaustiveCheck: never = node
        exhaustiveCheck
      }
      return ConstantTypes.NOT_CONSTANT
  }
}

function getGeneratedPropsConstantType(
  node: PlainElementNode,
  context: TransformContext
): ConstantTypes {
  let returnType = ConstantTypes.CAN_STRINGIFY
  const props = getNodeProps(node)
  if (props && props.type === NodeTypes.JS_OBJECT_EXPRESSION) {
    const { properties } = props
    for (let i = 0; i < properties.length; i++) {
      const { key, value } = properties[i]
      const keyType = getConstantType(key, context)
      if (keyType === ConstantTypes.NOT_CONSTANT) {
        return keyType
      }
      if (keyType < returnType) {
        returnType = keyType
      }
      if (value.type !== NodeTypes.SIMPLE_EXPRESSION) {
        return ConstantTypes.NOT_CONSTANT
      }
      const valueType = getConstantType(value, context)
      if (valueType === ConstantTypes.NOT_CONSTANT) {
        return valueType
      }
      if (valueType < returnType) {
        returnType = valueType
      }
    }
  }
  return returnType
}

function getNodeProps(node: PlainElementNode) {
  const codegenNode = node.codegenNode!
  if (codegenNode.type === NodeTypes.VNODE_CALL) {
    return codegenNode.props
  }
}

function getPatchFlag(node: VNodeCall): number | undefined {
  const flag = node.patchFlag
  return flag ? parseInt(flag, 10) : undefined
}
