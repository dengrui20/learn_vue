import {
  ConcreteComponent,
  getCurrentInstance,
  SetupContext,
  ComponentInternalInstance,
  LifecycleHooks,
  currentInstance,
  getComponentName
} from '../component'
import { VNode, cloneVNode, isVNode, VNodeProps } from '../vnode'
import { warn } from '../warning'
import {
  onBeforeUnmount,
  injectHook,
  onUnmounted,
  onMounted,
  onUpdated
} from '../apiLifecycle'
import {
  isString,
  isArray,
  ShapeFlags,
  remove,
  invokeArrayFns
} from '@vue/shared'
import { watch } from '../apiWatch'
import {
  RendererInternals,
  queuePostRenderEffect,
  MoveType,
  RendererElement,
  RendererNode,
  invokeVNodeHook
} from '../renderer'
import { setTransitionHooks } from './BaseTransition'
import { ComponentRenderContext } from '../componentPublicInstance'

type MatchPattern = string | RegExp | string[] | RegExp[]

export interface KeepAliveProps {
  include?: MatchPattern
  exclude?: MatchPattern
  max?: number | string
}

type CacheKey = string | number | ConcreteComponent
type Cache = Map<CacheKey, VNode>
type Keys = Set<CacheKey>

export interface KeepAliveContext extends ComponentRenderContext {
  renderer: RendererInternals
  activate: (
    vnode: VNode,
    container: RendererElement,
    anchor: RendererNode | null,
    isSVG: boolean,
    optimized: boolean
  ) => void
  deactivate: (vnode: VNode) => void
}

export const isKeepAlive = (vnode: VNode): boolean =>
  (vnode.type as any).__isKeepAlive

const KeepAliveImpl = {
  name: `KeepAlive`,

  // Marker for special handling inside the renderer. We are not using a ===
  // check directly on KeepAlive in the renderer, because importing it directly
  // would prevent it from being tree-shaken.
  // 用于渲染器内部特殊处理的标记
  // 我们没有在渲染器中直接对KeepAlive使用＝＝＝检查，因为直接导入它可以防止tree-shaken
  __isKeepAlive: true,

  props: {
    include: [String, RegExp, Array],
    exclude: [String, RegExp, Array],
    max: [String, Number]
  },

  setup(props: KeepAliveProps, { slots }: SetupContext) {
    const cache: Cache = new Map()
    const keys: Keys = new Set()
    let current: VNode | null = null

    const instance = getCurrentInstance()!
    const parentSuspense = instance.suspense

    // KeepAlive communicates with the instantiated renderer via the
    // ctx where the renderer passes in its internals,
    // and the KeepAlive instance exposes activate/deactivate implementations.
    // The whole point of this is to avoid importing KeepAlive directly in the
    // renderer to facilitate tree-shaking.
    // KeepAlive通过ctx与实例的renderer通信，渲染器在ctx中传递其内部属性，KeepAlive实例 activate/deactivate 实现
    // 这样做的目的是避免直接在renderer中导入KeepAlive，以便于tree-shaking

    /**
     * 
       在mountComponent 挂载keep-alive组件的时候
       
          if (isKeepAlive(initialVNode)) {
              instance.ctx.renderer = internals;
          }
        internals是一个对象
        const internals: RendererInternals = {
          p: patch,
          um: unmount,
          m: move,
          r: remove,
          mt: mountComponent,
          mc: mountChildren,
          pc: patchChildren,
          pbc: patchBlockChildren,
          n: getNextHostNode,
          o: options
        }
        里面有很多关于渲染的操作
        如果直接通过 import {unmount,xxx} from 'renderder.ts'
        这样会增加 keepAlive 组件的代码量 并且会有大量和renderer.ts里面重复的代码
        所以再挂载组件的时候把 renderer内部渲染的操作 通过对象传过来
        这样打包编译时 就不会把重复的代码打包进来
        直接通过 运行时 获取对应的操作
     */
    const sharedContext = instance.ctx as KeepAliveContext

    const {
      renderer: {
        p: patch,
        m: move,
        um: _unmount,
        o: { createElement }
      }
    } = sharedContext
    const storageContainer = createElement('div')

    // 保活的子组件重新渲染到视图的上的时候会触发
    // parentComponent.activate() => 在renderer.js  => processComponent方法内
    sharedContext.activate = (vnode, container, anchor, isSVG, optimized) => {
      const instance = vnode.component!
      // 将缓存组件的真是dom 插入到对应位置
      move(vnode, container, anchor, MoveType.ENTER, parentSuspense)
      // in case props have changed
      // 主要是为了更新props
      patch(
        instance.vnode,
        vnode,
        container,
        anchor,
        instance,
        parentSuspense,
        isSVG,
        optimized
      )
      queuePostRenderEffect(() => {
        // 这里的 instance是keepALive插槽子组件的
        instance.isDeactivated = false

        if (instance.a) {
          // 触发 activated 的钩子
          invokeArrayFns(instance.a)
        }
        const vnodeHook = vnode.props && vnode.props.onVnodeMounted

        if (vnodeHook) {
          // 触发传入的 onVnodeMounted函数
          invokeVNodeHook(vnodeHook, instance.parent, vnode)
        }
      }, parentSuspense)
    }

    // 保活的子组件重从视图移除的时候
    // parentComponent.deactivate() 在renderer.js  => processComponent方法内
    sharedContext.deactivate = (vnode: VNode) => {
      const instance = vnode.component!
      // 将渲染组件的真是dom 移动到一个变量storageContainer缓存的div中
      move(vnode, storageContainer, null, MoveType.LEAVE, parentSuspense)
      queuePostRenderEffect(() => {
        if (instance.da) {
          // 触发 deactivate 的钩子
          invokeArrayFns(instance.da)
        }
        const vnodeHook = vnode.props && vnode.props.onVnodeUnmounted
        if (vnodeHook) {
          invokeVNodeHook(vnodeHook, instance.parent, vnode)
        }
        instance.isDeactivated = true
      }, parentSuspense)
    }

    function unmount(vnode: VNode) {
      // reset the shapeFlag so it can be properly unmounted
      // 重置shapeFlag，以便可以正确卸载
      resetShapeFlag(vnode)
      // 销毁组件
      _unmount(vnode, instance, parentSuspense)
    }

    function pruneCache(filter?: (name: string) => boolean) {
      cache.forEach((vnode, key) => {
        const name = getComponentName(vnode.type as ConcreteComponent)
        if (name && (!filter || !filter(name))) {
          pruneCacheEntry(key)
        }
      })
    }

    function pruneCacheEntry(key: CacheKey) {
      const cached = cache.get(key) as VNode
      if (!current || cached.type !== current.type) {
        unmount(cached)
      } else if (current) {
        // current active instance should no longer be kept-alive.
        // we can't unmount it now but it might be later, so reset its flag now.
        resetShapeFlag(current)
      }
      cache.delete(key)
      keys.delete(key)
    }

    // prune cache on include/exclude prop change
    watch(
      () => [props.include, props.exclude],
      ([include, exclude]) => {
        include && pruneCache(name => matches(include, name))
        exclude && pruneCache(name => !matches(exclude, name))
      },
      // prune post-render after `current` has been updated
      { flush: 'post', deep: true }
    )

    // cache sub tree after render
    // render渲染之后 缓存组件内部真实的渲染vnode
    let pendingCacheKey: CacheKey | null = null
    const cacheSubtree = () => {
      // fix #1621, the pendingCacheKey could be 0
      if (pendingCacheKey != null) {
        cache.set(pendingCacheKey, getInnerChild(instance.subTree))
      }
    }
    onMounted(cacheSubtree)
    onUpdated(cacheSubtree)

    onBeforeUnmount(() => {
      cache.forEach(cached => {
        const { subTree, suspense } = instance
        const vnode = getInnerChild(subTree)
        if (cached.type === vnode.type) {
          // current instance will be unmounted as part of keep-alive's unmount
          // 重置 ShapeFlag
          resetShapeFlag(vnode)
          // but invoke its deactivated hook here
          // 销毁当前keepAlive实例是其实也销毁了缓存的子组件
          // 所以要触发子组件的 deactivate 钩子
          const da = vnode.component!.da
          da && queuePostRenderEffect(da, suspense)
          return
        }
        // 卸载缓存的组件
        unmount(cached)
      })
    })

    return () => {
      pendingCacheKey = null

      if (!slots.default) {
        return null
      }

      // 找到默认插槽的第一个子元素
      const children = slots.default()

      const rawVNode = children[0]
      if (children.length > 1) {
        if (__DEV__) {
          warn(`KeepAlive should contain exactly one component child.`)
        }
        // 如果有多个子元素 直接渲染所有族元素
        current = null
        return children
      } else if (
        !isVNode(rawVNode) ||
        (!(rawVNode.shapeFlag & ShapeFlags.STATEFUL_COMPONENT) &&
          !(rawVNode.shapeFlag & ShapeFlags.SUSPENSE))
      ) {
        // 如果不是一个vnode 或者 不需要缓存 直接渲染元素
        current = null
        return rawVNode
      }

      let vnode = getInnerChild(rawVNode)
      const comp = vnode.type as ConcreteComponent
      const name = getComponentName(comp)
      const { include, exclude, max } = props

      if (
        (include && (!name || !matches(include, name))) ||
        (exclude && name && matches(exclude, name))
      ) {
        // 如果当前组件被指定不缓存 也直接渲染
        current = vnode
        return rawVNode
      }

      const key = vnode.key == null ? comp : vnode.key
      const cachedVNode = cache.get(key)
      // 在缓存中获取当前组件vnode
      // clone vnode if it's reused because we are going to mutate it
      // 需要clone当前vnode 因为后面会对vnode进行修改 要保证原vnode 不受污染
      if (vnode.el) {
        vnode = cloneVNode(vnode)
        if (rawVNode.shapeFlag & ShapeFlags.SUSPENSE) {
          rawVNode.ssContent = vnode
        }
      }
      // #1513 it's possible for the returned vnode to be cloned due to attr
      // fallthrough or scopeId, so the vnode here may not be the final vnode
      // that is mounted. Instead of caching it directly, we store the pending
      // key and cache `instance.subTree` (the normalized vnode) in
      // beforeMount/beforeUpdate hooks.
      /**
        由于attrs 为空或者scopedId的原因, 返回的vnode可能被克隆过
        因此，此处的vnode可能不是挂载的最终vnode
        所以我们不能直接缓存该vnode
        而是需要存储key和 instance.subTree(渲染vnode)
        当前实例的subTree 一定是最后渲染的vnode
        在  beforeMount/beforeUpdate 钩子里 
      */
      pendingCacheKey = key

      if (cachedVNode) {
        // copy over mounted state
        // 复制过挂载的状态
        vnode.el = cachedVNode.el
        vnode.component = cachedVNode.component
        if (vnode.transition) {
          // recursively update transition hooks on subTree
          setTransitionHooks(vnode, vnode.transition!)
        }
        // avoid vnode being mounted as fresh
        // 给缓存过后的vnode 标识 COMPONENT_KEPT_ALIVE
        // 后面挂载的时候 就不会重新创建 直接读取内存的
        vnode.shapeFlag |= ShapeFlags.COMPONENT_KEPT_ALIVE
        // make this key the freshest
        // 把key 更新在在队列的最后面
        keys.delete(key)
        keys.add(key)
      } else {
        // 如果没有缓存过
        // 将key 添加到队列中
        keys.add(key)
        // prune oldest entry
        // 把超出数量的最久没有访问过的组件缓存清除掉
        if (max && keys.size > parseInt(max as string, 10)) {
          pruneCacheEntry(keys.values().next().value)
        }
      }
      // avoid vnode being unmounted
      // 卸载unounted的时候 如果有 shapeFlag & ShapeFlags.COMPONENT_SHOULD_KEEP_ALIVE > 0
      // 就会执行 ctx.deactivate 钩子 不会卸载 keepalive组件
      vnode.shapeFlag |= ShapeFlags.COMPONENT_SHOULD_KEEP_ALIVE

      current = vnode
      return rawVNode
    }
  }
}

// export the public type for h/tsx inference
// also to avoid inline import() in generated d.ts files
export const KeepAlive = (KeepAliveImpl as any) as {
  __isKeepAlive: true
  new (): {
    $props: VNodeProps & KeepAliveProps
  }
}

function matches(pattern: MatchPattern, name: string): boolean {
  if (isArray(pattern)) {
    return pattern.some((p: string | RegExp) => matches(p, name))
  } else if (isString(pattern)) {
    return pattern.split(',').indexOf(name) > -1
  } else if (pattern.test) {
    return pattern.test(name)
  }
  /* istanbul ignore next */
  return false
}

export function onActivated(
  hook: Function,
  target?: ComponentInternalInstance | null
) {
  registerKeepAliveHook(hook, LifecycleHooks.ACTIVATED, target)
}

export function onDeactivated(
  hook: Function,
  target?: ComponentInternalInstance | null
) {
  registerKeepAliveHook(hook, LifecycleHooks.DEACTIVATED, target)
}

function registerKeepAliveHook(
  hook: Function & { __wdc?: Function },
  type: LifecycleHooks,
  target: ComponentInternalInstance | null = currentInstance
) {
  // cache the deactivate branch check wrapper for injected hooks so the same
  // hook can be properly deduped by the scheduler. "__wdc" stands for "with
  // deactivation check".
  const wrappedHook =
    hook.__wdc ||
    (hook.__wdc = () => {
      // only fire the hook if the target instance is NOT in a deactivated branch.
      let current: ComponentInternalInstance | null = target
      while (current) {
        if (current.isDeactivated) {
          return
        }
        current = current.parent
      }
      hook()
    })
  injectHook(type, wrappedHook, target)
  // In addition to registering it on the target instance, we walk up the parent
  // chain and register it on all ancestor instances that are keep-alive roots.
  // This avoids the need to walk the entire component tree when invoking these
  // hooks, and more importantly, avoids the need to track child components in
  // arrays.
  if (target) {
    let current = target.parent
    while (current && current.parent) {
      if (isKeepAlive(current.parent.vnode)) {
        injectToKeepAliveRoot(wrappedHook, type, target, current)
      }
      current = current.parent
    }
  }
}

function injectToKeepAliveRoot(
  hook: Function & { __weh?: Function },
  type: LifecycleHooks,
  target: ComponentInternalInstance,
  keepAliveRoot: ComponentInternalInstance
) {
  // injectHook wraps the original for error handling, so make sure to remove
  // the wrapped version.
  const injected = injectHook(type, hook, keepAliveRoot, true /* prepend */)
  onUnmounted(() => {
    remove(keepAliveRoot[type]!, injected)
  }, target)
}

function resetShapeFlag(vnode: VNode) {
  let shapeFlag = vnode.shapeFlag
  // 取消 COMPONENT_SHOULD_KEEP_ALIVE 和 COMPONENT_KEPT_ALIVE 的标识
  // COMPONENT_SHOULD_KEEP_ALIVE 需要缓存的标识
  // COMPONENT_KEPT_ALIVE 已经缓存的标识
  if (shapeFlag & ShapeFlags.COMPONENT_SHOULD_KEEP_ALIVE) {
    shapeFlag -= ShapeFlags.COMPONENT_SHOULD_KEEP_ALIVE
  }
  if (shapeFlag & ShapeFlags.COMPONENT_KEPT_ALIVE) {
    shapeFlag -= ShapeFlags.COMPONENT_KEPT_ALIVE
  }
  vnode.shapeFlag = shapeFlag
}

function getInnerChild(vnode: VNode) {
  return vnode.shapeFlag & ShapeFlags.SUSPENSE ? vnode.ssContent! : vnode
}
