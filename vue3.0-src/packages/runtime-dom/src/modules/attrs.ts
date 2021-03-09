import { isSpecialBooleanAttr } from '@vue/shared'

export const xlinkNS = 'http://www.w3.org/1999/xlink'

export function patchAttr(
  el: Element,
  key: string,
  value: any,
  isSVG: boolean
) {
  if (isSVG && key.startsWith('xlink:')) {
    // svg标签处理
    if (value == null) {
      // 移除属性
      el.removeAttributeNS(xlinkNS, key.slice(6, key.length))
    } else {
      // 设置属性
      el.setAttributeNS(xlinkNS, key, value)
    }
  } else {
    // note we are only checking boolean attributes that don't have a
    // corresponding dom prop of the same name here.
    // 注意，我们只检查没有同名对应dom属性的布尔属性
    // 如 readyOnly
    const isBoolean = isSpecialBooleanAttr(key)
    if (value == null || (isBoolean && value === false)) {
      el.removeAttribute(key)
    } else {
      el.setAttribute(key, isBoolean ? '' : value)
    }
  }
}
