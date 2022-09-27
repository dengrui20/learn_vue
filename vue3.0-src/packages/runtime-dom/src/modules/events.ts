import { hyphenate, isArray } from '@vue/shared'
import {
  ComponentInternalInstance,
  callWithAsyncErrorHandling
} from '@vue/runtime-core'
import { ErrorCodes } from 'packages/runtime-core/src/errorHandling'

interface Invoker extends EventListener {
  value: EventValue
  attached: number
}

type EventValue = Function | Function[]

// Async edge case fix requires storing an event listener's attach timestamp.
let _getNow: () => number = Date.now

// Determine what event timestamp the browser is using. Annoyingly, the
// timestamp can either be hi-res (relative to page load) or low-res
// (relative to UNIX epoch), so in order to compare time we have to use the
// same timestamp type when saving the flush timestamp.
if (
  typeof document !== 'undefined' &&
  _getNow() > document.createEvent('Event').timeStamp
) {
  // if the low-res timestamp which is bigger than the event timestamp
  // (which is evaluated AFTER) it means the event is using a hi-res timestamp,
  // and we need to use the hi-res version for event listeners as well.
  _getNow = () => performance.now()
}

// To avoid the overhead of repeatedly calling performance.now(), we cache
// and use the same timestamp for all event listeners attached in the same tick.
let cachedNow: number = 0
const p = Promise.resolve()
const reset = () => {
  cachedNow = 0
}
const getNow = () => cachedNow || (p.then(reset), (cachedNow = _getNow()))

export function addEventListener(
  el: Element,
  event: string,
  handler: EventListener,
  options?: EventListenerOptions
) {
  el.addEventListener(event, handler, options)
}

export function removeEventListener(
  el: Element,
  event: string,
  handler: EventListener,
  options?: EventListenerOptions
) {
  el.removeEventListener(event, handler, options)
}

export function patchEvent(
  el: Element & { _vei?: Record<string, Invoker | undefined> },
  rawName: string,
  prevValue: EventValue | null,
  nextValue: EventValue | null,
  instance: ComponentInternalInstance | null = null
) {
  // vei = vue event invokers
  const invokers = el._vei || (el._vei = {})
  const existingInvoker = invokers[rawName]
  // 从缓存里找到之前该元素是否绑定过对应事件
  if (nextValue && existingInvoker) {
    // patch
    // 如果绑定过 直接修改调用的函数
    existingInvoker.value = nextValue
  } else {
    const [name, options] = parseName(rawName)
    if (nextValue) {
      // 创建一个调用函数 这个函数内部调用了用户传入的函数 如果用户传如的函数改变了 调用的函数也会改变
      // 主要是做事件缓存 更新时只需要更新调用的函数
      // 不用频繁的 addEventListener 和 removeEventListener
      /**
       *   function invoker() {  invoker.value() }
       *   invoker.value = customFn
           更新 invoker.value 就可以直接修改调用函数 
       *  addEventListener(el, name, invoker)
       */
      const invoker = (invokers[rawName] = createInvoker(nextValue, instance))
      addEventListener(el, name, invoker, options)
    } else if (existingInvoker) {
      // remove
      // 移除之前绑定的 invokers
      removeEventListener(el, name, existingInvoker, options)
      invokers[rawName] = undefined
    }
  }
}

const optionsModifierRE = /(?:Once|Passive|Capture)$/

function parseName(name: string): [string, EventListenerOptions | undefined] {
  let options: EventListenerOptions | undefined
  if (optionsModifierRE.test(name)) {
    options = {}
    let m
    while ((m = name.match(optionsModifierRE))) {
      name = name.slice(0, name.length - m[0].length)
      ;(options as any)[m[0].toLowerCase()] = true
      options
    }
  }
  return [hyphenate(name.slice(2)), options]
}

function createInvoker(
  initialValue: EventValue,
  instance: ComponentInternalInstance | null
) {
  const invoker: Invoker = (e: Event) => {
    // async edge case #6566: inner click event triggers patch, event handler
    // attached to outer element during patch, and triggered again. This
    // happens because browsers fire microtask ticks between event propagation.
    // the solution is simple: we save the timestamp when a handler is attached,
    // and the handler would only fire if the event passed to it was fired
    // AFTER it was attached.
    // 创建一个函数
    /**
     * 
      给事件创建一个时间戳 invoker.attached = getNow()
      这个时间戳用于保存事件绑定事件
      flag 默认为一个false的响应值
      <div @click="flag ? event1 : null" >
        <p @click="flag = true">
          绑定事件
        </p>
      </div>
      初始化渲染的时候默认不会在div上绑定 event1
      当点击p元素的时候 也会触发event1
      因为 div 元素绑定事件处理函数发生在事件冒泡之前(微任务的优先级是更高的，是会优先于事件冒泡的, 点击p元素,触发更新队列, 更新队列更新完绑定了事件, 再触发了事件冒泡)
      这种情况违反用户直觉的
      为了解决这种问题, 绑定事件时候给一个时间戳 attached
      触发事件的时候 效验事件
      所有触发时间在绑定事件之前的都过滤掉
      只触发 绑定之后触发的时间
     */
    const timeStamp = e.timeStamp || _getNow()
    if (timeStamp >= invoker.attached - 1) {
      callWithAsyncErrorHandling(
        patchStopImmediatePropagation(e, invoker.value),
        instance,
        ErrorCodes.NATIVE_EVENT_HANDLER,
        [e]
      )
    }
  }
  // 函数设置一个value 值为用户绑定的函数
  invoker.value = initialValue
  invoker.attached = getNow()
  return invoker
}

function patchStopImmediatePropagation(
  e: Event,
  value: EventValue
): EventValue {
  if (isArray(value)) {
    const originalStop = e.stopImmediatePropagation
    e.stopImmediatePropagation = () => {
      originalStop.call(e)
      ;(e as any)._stopped = true
    }
    return value.map(fn => (e: Event) => !(e as any)._stopped && fn(e))
  } else {
    return value
  }
}
