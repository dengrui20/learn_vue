// __UNSAFE__
// Reason: potentially setting innerHTML.
// This can come from explicit usage of v-html or innerHTML as a prop in render

import { warn } from '@vue/runtime-core'

// functions. The user is responsible for using them with only trusted content.
export function patchDOMProp(
  el: any,
  key: string,
  value: any,
  // the following args are passed only due to potential innerHTML/textContent
  // overriding existing VNodes, in which case the old tree must be properly
  // unmounted.
  // 以下参数仅因潜在的innerHTML/textContent而传递：覆盖现有的vnode，在这种情况下，必须正确卸载旧的树
  prevChildren: any,
  parentComponent: any,
  parentSuspense: any,
  unmountChildren: any
) {
  // 如果修改了innerHTML / textContent 直接覆盖原来的dom 直接覆盖原来的vdom树
  if (key === 'innerHTML' || key === 'textContent') {
    if (prevChildren) {
      unmountChildren(prevChildren, parentComponent, parentSuspense)
    }
    el[key] = value == null ? '' : value
    return
  }

  if (key === 'value' && el.tagName !== 'PROGRESS') {
    // store value as _value as well since
    // non-string values will be stringified.
    // 将值存储为_value，因为非字符串值将被字符串化。
    el._value = value
    const newValue = value == null ? '' : value
    if (el.value !== newValue) {
      el.value = newValue
    }
    return
  }

  if (value === '' || value == null) {
    const type = typeof el[key]
    if (value === '' && type === 'boolean') {
      // e.g. <select multiple> compiles to { multiple: '' }
      /**
       * 
        <input disabled></input>
        这种情况下 属性为 获得 { disabled: '' }
        但是disabled是布尔类型所以会转换为
        {disabled: false}
        但是用户其实是 想禁用
        所以要手动矫正 为true
       */
      el[key] = true
      return
    } else if (value == null && type === 'string') {
      // e.g. <div :id="null">
      el[key] = ''
      el.removeAttribute(key)
      return
    } else if (type === 'number') {
      // e.g. <img :width="null">
      el[key] = 0
      el.removeAttribute(key)
      return
    }
  }

  // some properties perform value validation and throw
  try {
    el[key] = value
  } catch (e) {
    if (__DEV__) {
      warn(
        `Failed setting prop "${key}" on <${el.tagName.toLowerCase()}>: ` +
          `value ${value} is invalid.`,
        e
      )
    }
  }
}
