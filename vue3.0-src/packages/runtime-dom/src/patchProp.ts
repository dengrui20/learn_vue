import { patchClass } from './modules/class'
import { patchStyle } from './modules/style'
import { patchAttr } from './modules/attrs'
import { patchDOMProp } from './modules/props'
import { patchEvent } from './modules/events'
import {
  isOn,
  isString,
  isFunction,
  isModelListener,
  isFormTag
} from '@vue/shared'
import { RendererOptions } from '@vue/runtime-core'

const nativeOnRE = /^on[a-z]/

type DOMRendererOptions = RendererOptions<Node, Element>

export const forcePatchProp: DOMRendererOptions['forcePatchProp'] = (_, key) =>
  key === 'value'

export const patchProp: DOMRendererOptions['patchProp'] = (
  el,
  key,
  prevValue,
  nextValue,
  isSVG = false,
  prevChildren,
  parentComponent,
  parentSuspense,
  unmountChildren
) => {
  // 对class 和style 属性进行特殊处理
  switch (key) {
    // special
    case 'class':
      patchClass(el, nextValue, isSVG)
      break
    case 'style':
      patchStyle(el, prevValue, nextValue)
      break
    default:
      if (isOn(key)) {
        // ignore v-model listeners
        if (!isModelListener(key)) {
          //  如果是事件 并且不是v-model事件 去更新事件
          patchEvent(el, key, prevValue, nextValue, parentComponent)
        }
      } else if (shouldSetAsProp(el, key, nextValue, isSVG)) {
        // 判断是不是可以设置的props 如果是的 更新dom prop
        /**
        如 <div id="app" customProp="222">
        div.id = 'app2' 这种属性即可以获取 也可以设置
        div.customProp = 'a' 设置是无效的 所以需要手动调用 setAttribute 去修改 走else 逻辑
        
        */
        patchDOMProp(
          el,
          key,
          nextValue,
          prevChildren,
          parentComponent,
          parentSuspense,
          unmountChildren
        )
      } else {
        // special case for <input v-model type="checkbox"> with
        // :true-value & :false-value
        // store value as dom properties since non-string values will be
        // stringified.
        if (key === 'true-value') {
          ;(el as any)._trueValue = nextValue
        } else if (key === 'false-value') {
          ;(el as any)._falseValue = nextValue
        }
        patchAttr(el, key, nextValue, isSVG)
      }
      break
  }
}

function shouldSetAsProp(
  el: Element,
  key: string,
  value: unknown,
  isSVG: boolean
) {
  // 判断是否能设置该属性
  if (isSVG) {
    // most keys must be set as attribute on svg elements to work
    // 大多数键必须设置为svg元素的属性才能工作
    // ...except innerHTML
    if (key === 'innerHTML') {
      return true
    }
    // or native onclick with function values
    // 如果是原生click函数
    if (key in el && nativeOnRE.test(key) && isFunction(value)) {
      return true
    }
    return false
  }

  // spellcheck and draggable are numerated attrs, however their
  // corresponding DOM properties are actually booleans - this leads to
  // setting it with a string "false" value leading it to be coerced to
  // `true`, so we need to always treat them as attributes.
  // Note that `contentEditable` doesn't have this problem: its DOM
  // property is also enumerated string values.
  if (key === 'spellcheck' || key === 'draggable') {
    return false
  }

  // #1787, #2840 the form property is readonly and can only be set as an
  // attribute using a string value
  if (key === 'form' && isFormTag(el.tagName)) {
    /**
      很多表单标签的 form 属性是只读的
      如 <input form="form1" />
    */
    return false
  }

  // #1526 <input list> must be set as attribute
  if (key === 'list' && el.tagName === 'INPUT') {
    return false
  }

  // native onclick with string value, must be set as attribute
  if (nativeOnRE.test(key) && isString(value)) {
    return false
  }

  return key in el
}
