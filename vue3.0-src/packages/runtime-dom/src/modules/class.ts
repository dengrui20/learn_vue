import { ElementWithTransition } from '../components/Transition'

// compiler should normalize class + :class bindings on the same element
// into a single binding ['staticClass', dynamic]
// 编译器应将类 class+：同一元素上的类绑定规范化为单个绑定['staticClass'，dynamic]
export function patchClass(el: Element, value: string | null, isSVG: boolean) {
  if (value == null) {
    // 清空class
    value = ''
  }
  if (isSVG) {
    el.setAttribute('class', value)
  } else {
    // directly setting className should be faster than setAttribute in theory
    // if this is an element during a transition, take the temporary transition
    // classes into account.
    /**
     * 从理论上讲，直接设置className应该比setAttribute快
     * 如果这是transiton中的元素，请考虑临时转换class。
     */
    const transitionClasses = (el as ElementWithTransition)._vtc
    if (transitionClasses) {
      value = (value
        ? [value, ...transitionClasses]
        : [...transitionClasses]
      ).join(' ')
    }
    el.className = value
  }
}
