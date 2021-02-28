import {
  reactive,
  readonly,
  toRaw,
  ReactiveFlags,
  Target,
  readonlyMap,
  reactiveMap
} from './reactive'
import { TrackOpTypes, TriggerOpTypes } from './operations'
import {
  track,
  trigger,
  ITERATE_KEY,
  pauseTracking,
  resetTracking
} from './effect'
import {
  isObject,
  hasOwn,
  isSymbol,
  hasChanged,
  isArray,
  isIntegerKey,
  extend,
  makeMap
} from '@vue/shared'
import { isRef } from './ref'

const isNonTrackableKeys = /*#__PURE__*/ makeMap(`__proto__,__v_isRef,__isVue`)

const builtInSymbols = new Set(
  Object.getOwnPropertyNames(Symbol)
    .map(key => (Symbol as any)[key])
    .filter(isSymbol)
)

const get = /*#__PURE__*/ createGetter()
const shallowGet = /*#__PURE__*/ createGetter(false, true)
const readonlyGet = /*#__PURE__*/ createGetter(true)
const shallowReadonlyGet = /*#__PURE__*/ createGetter(true, true)

const arrayInstrumentations: Record<string, Function> = {}
// instrument identity-sensitive Array methods to account for possible reactive
// values
;(['includes', 'indexOf', 'lastIndexOf'] as const).forEach(key => {
  // 方法劫持 重写原有方法 增加自定义逻辑
  // [a, b, c].includes(x)
  // x 可能是 a 或者 b c 当 a b c改变了都要触发更新 所以需要对数组的每一项进行依赖收集 
  const method = Array.prototype[key] as any
  arrayInstrumentations[key] = function(this: unknown[], ...args: unknown[]) {
    const arr = toRaw(this) // toRaw 可以把响应式对象转成原始数据
    for (let i = 0, l = this.length; i < l; i++) {
      // 对数组的每一项都进行依赖收集
      track(arr, TrackOpTypes.GET, i + '')
    }
    // we run the method using the original args first (which may be reactive)
    const res = method.apply(arr, args) // 调用原生的api 查询结果
    if (res === -1 || res === false) {
      // 如果获取失败则把参数转换成原始数据再次查找并且返回结果
      // if that didn't work, run it again using raw values.
      return method.apply(arr, args.map(toRaw))
    } else {
      return res
    }
  }
})
// instrument length-altering mutation methods to avoid length being tracked
// which leads to infinite loops in some cases (#2137)
// length被修改可能会导致无线循环
/**
 *  effect(() => arr.push(1)) length改变 会触发 effect2
 *  effect(() => arr.push(2)) length改变 会触发 effect1
 *  调用改变数组方法的时候 会改变数组的length 这时候会访问length  对length进行依赖收集
 *  这样会导致无限调用 
 *  所以调用改变数组的一些方法的时候不能进行依赖收集
 */
;(['push', 'pop', 'shift', 'unshift', 'splice'] as const).forEach(key => {
  const method = Array.prototype[key] as any
  arrayInstrumentations[key] = function(this: unknown[], ...args: unknown[]) {
    pauseTracking() // 暂停依赖收集
    const res = method.apply(this, args)
    resetTracking()
    return res
  }
})

// 创建代理getter
function createGetter(isReadonly = false, shallow = false) {
  return function get(target: Target, key: string | symbol, receiver: object) {
    if (key === ReactiveFlags.IS_REACTIVE) {
      return !isReadonly
    } else if (key === ReactiveFlags.IS_READONLY) {
      return isReadonly
    } else if (
      // 如果是获取代理对象的原始值 则直接返回
      key === ReactiveFlags.RAW &&
      receiver === (isReadonly ? readonlyMap : reactiveMap).get(target)
    ) {
      return target
    }

    const targetIsArray = isArray(target)

    // 如果不是只读 并且是数组
    if (!isReadonly && targetIsArray && hasOwn(arrayInstrumentations, key)) {
      // arrayInstrumentations 包含对数组一些方法修改的函数
      // 因为一旦数组的元素被修改，数组的这几个 API 的返回结果都可能发生变化，所以我们需要跟踪数组每个元素的变化。
      return Reflect.get(arrayInstrumentations, key, receiver)
    }

    const res = Reflect.get(target, key, receiver)

    // 如果是内置的symbol 或者是原型链查找到的 直接返回 
    // 不会对这些值进行依赖收集 比如__proto__
    if (
      isSymbol(key)
        ? builtInSymbols.has(key as symbol)
        : isNonTrackableKeys(key)
    ) {
      return res
    }

    if (!isReadonly) {
      // 取值的时候进行依赖收集
      track(target, TrackOpTypes.GET, key)
    }

    if (shallow) {
      // 如果是浅层监听直接返回代理的值
      return res
    }

    if (isRef(res)) { 
      // 如果这个值是ref 则直接返回ref对象的value
      /**
       * let state = reactive({a: ref(1)}) 
       * ref取值应该带value
       * state.a.value
       * 处理后State.a 会直接返回对应的value
       * 
       * 但是
       * let state = reactive([ref(1)])
       * state[0].value
       * 数组里的值不会做这层处理
       */
      // ref unwrapping - does not apply for Array + integer key.
      const shouldUnwrap = !targetIsArray || !isIntegerKey(key)
      return shouldUnwrap ? res.value : res
    }

    if (isObject(res)) {
      // Convert returned value into a proxy as well. we do the isObject check  将返回值也转换为代理。我们做isObject检查
      // here to avoid invalid value warning. Also need to lazy access readonly 
      // and reactive here to avoid circular dependency.  此处避免出现无效值警告。这里还需要延迟访问readonly和reactive，以避免循环依赖
      // 递归代理
      // 这一步只有取值时才会递归代理 vue2.0 在一开始就会递归代理 相对性能会更高
      return isReadonly ? readonly(res) : reactive(res)
    }

    return res
  }
}

const set = /*#__PURE__*/ createSetter()
const shallowSet = /*#__PURE__*/ createSetter(true)

// 创建代理setter
function createSetter(shallow = false) {
  return function set(
    target: object,
    key: string | symbol,
    value: unknown,
    receiver: object
  ): boolean {
    const oldValue = (target as any)[key]
    if (!shallow) {
      // 如果对象被深层代理了
      value = toRaw(value) 
      if (!isArray(target) && isRef(oldValue) && !isRef(value)) {
        // 如果不是数组 && 旧值是ref && 新值不是ref
        /**
         * 如 let state = reactive({ a: ref(1) }) 
         * state.a = 1
         * 这时候改的其实是 state.a.value = 1
         *
        */
        oldValue.value = value
        return true
      }
    } else {
      // in shallow mode, objects are set as-is regardless of reactive or not
    }

    // 在target上查找 是否存在当前的key 
    // 对数组进行特殊处理
    // target是个数组 && key是一个整形的(数字或者字符串)
    // key > length 则不存在当前的key
    // 数组调用push 等修改数组的方法也会修改/或新增 key
    const hadKey =
      isArray(target) && isIntegerKey(key)
        ? Number(key) < target.length
        : hasOwn(target, key)
    const result = Reflect.set(target, key, value, receiver)
    // don't trigger if target is something up in the prototype chain of original
    if (target === toRaw(receiver)) {
      /**
       * 对原型链做代理进行特殊处理
       * let obj = {}
       * let proto = {a: 1}
       * let proxyProto = new Proxy(proto, {
       *   get() {},
       *   set(target, key, value, receiver) {
       *    receiver === myProxy => true **************
       *   }
       * })
       * 
       * 改变obj的原型 指向被代理后的proxyProto
       * Object.setPrototypeOf(obj, proxyProto)
       * 
       * let myProxy = new Proxy(obj, {
       *  get() {},
       *  set(target, key, value, receiver) {
       *    receiver === myProxy => true ***********8
       *  }
       * })
       * myProxy.a = 100
       * 
       * myProxy.a 
       * 先触发myProxy.get 不存在 会顺着原型链向上查找
       * 触发了proxyProto.get
       * 触发了2次set
       *  
       * target === toRaw(receiver)
       * 通过判断
       * target => obj  
       * toRaw(receiver) => 被代理前的原始值
       * 这样就会避免这种极端情况触发
       * 
       * 
      */

      if (!hadKey) {
        // 如果 不存在key 就是新增 否则就是 修改值
        // trigger 触发对应操作执行的流程
        trigger(target, TriggerOpTypes.ADD, key, value)
      } else if (hasChanged(value, oldValue)) {// 如果新值和旧值不相同才会修改
        trigger(target, TriggerOpTypes.SET, key, value, oldValue)
      }
    }
    return result
  }
}

function deleteProperty(target: object, key: string | symbol): boolean {
  const hadKey = hasOwn(target, key)
  const oldValue = (target as any)[key]
  const result = Reflect.deleteProperty(target, key)
  if (result && hadKey) {
    trigger(target, TriggerOpTypes.DELETE, key, undefined, oldValue)
  }
  return result
}

function has(target: object, key: string | symbol): boolean {
  const result = Reflect.has(target, key)
  if (!isSymbol(key) || !builtInSymbols.has(key)) {
    track(target, TrackOpTypes.HAS, key)
  }
  return result
}

function ownKeys(target: object): (string | number | symbol)[] {
  track(target, TrackOpTypes.ITERATE, isArray(target) ? 'length' : ITERATE_KEY)
  return Reflect.ownKeys(target)
}

// 普通的拦截的代理配置
export const mutableHandlers: ProxyHandler<object> = {
  get,
  set,
  deleteProperty,
  has,
  ownKeys
}

// 只读数据拦截的代理配置
export const readonlyHandlers: ProxyHandler<object> = {
  get: readonlyGet,
  set(target, key) {
    if (__DEV__) {
      console.warn(
        `Set operation on key "${String(key)}" failed: target is readonly.`,
        target
      )
    }
    return true
  },
  deleteProperty(target, key) {
    if (__DEV__) {
      console.warn(
        `Delete operation on key "${String(key)}" failed: target is readonly.`,
        target
      )
    }
    return true
  }
}

// 浅层监听响应数据的代理配置
export const shallowReactiveHandlers: ProxyHandler<object> = extend(
  {},
  mutableHandlers,
  {
    get: shallowGet,
    set: shallowSet
  }
)

// Props handlers are special in the sense that it should not unwrap top-level
// refs (in order to allow refs to be explicitly passed down), but should
// retain the reactivity of the normal readonly object.

// 浅层监听只读数据的代理配置
export const shallowReadonlyHandlers: ProxyHandler<object> = extend(
  {},
  readonlyHandlers,
  {
    get: shallowReadonlyGet
  }
)
