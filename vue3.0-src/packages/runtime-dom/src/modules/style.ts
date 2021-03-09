import { isString, hyphenate, capitalize, isArray } from '@vue/shared'
import { camelize } from '@vue/runtime-core'

type Style = string | Record<string, string | string[]> | null

export function patchStyle(el: Element, prev: Style, next: Style) {
  const style = (el as HTMLElement).style
  if (!next) {
    // 如果清空style 直接移除
    el.removeAttribute('style')
  } else if (isString(next)) {
    // 如果style属性是字符串
    if (prev !== next) {
      style.cssText = next
    }
  } else {
    for (const key in next) {
      // 设置新的style
      setStyle(style, key, next[key])
    }
    if (prev && !isString(prev)) {
      for (const key in prev) {
        if (next[key] == null) {
          // 如果新style 没有这个属性 旧值有 则直接删除旧的css属性
          setStyle(style, key, '')
        }
      }
    }
  }
}

const importantRE = /\s*!important$/

function setStyle(
  style: CSSStyleDeclaration,
  name: string,
  val: string | string[]
) {
  if (isArray(val)) {
    // 处理style是数组的情况
    val.forEach(v => setStyle(style, name, v))
  } else {
    if (name.startsWith('--')) {
      // custom property definition
      // 如果是自定义特性 直接设置style新属性
      style.setProperty(name, val)
    } else {
      // 每个属性添加前缀 
      const prefixed = autoPrefix(style, name)
      // 如果style 后面存在  !important
      if (importantRE.test(val)) {
        // !important
        //style.setProperty(name, value, 'important')
        style.setProperty(
          hyphenate(prefixed),
          val.replace(importantRE, ''),
          'important'
        )
      } else {
        style[prefixed as any] = val
      }
    }
  }
}

const prefixes = ['Webkit', 'Moz', 'ms']
const prefixCache: Record<string, string> = {}

function autoPrefix(style: CSSStyleDeclaration, rawName: string): string {
  const cached = prefixCache[rawName]
  if (cached) {
    return cached
  }
  let name = camelize(rawName)
  if (name !== 'filter' && name in style) {
    return (prefixCache[rawName] = name)
  }
  name = capitalize(name)
  for (let i = 0; i < prefixes.length; i++) {
    const prefixed = prefixes[i] + name
    if (prefixed in style) {
      return (prefixCache[rawName] = prefixed)
    }
  }
  return rawName
}
