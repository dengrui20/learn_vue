import { TrackOpTypes, TriggerOpTypes } from './operations'
import { EMPTY_OBJ, isArray, isIntegerKey, isMap } from '@vue/shared'

// The main WeakMap that stores {target -> key -> dep} connections.
// Conceptually, it's easier to think of a dependency as a Dep class
// which maintains a Set of subscribers, but we simply store them as
// raw Sets to reduce memory overhead.
type Dep = Set<ReactiveEffect>
type KeyToDepMap = Map<any, Dep>
const targetMap = new WeakMap<any, KeyToDepMap>() // 记录某个属性 对应的effect函数

export interface ReactiveEffect<T = any> {
  (): T
  _isEffect: true
  id: number
  active: boolean
  raw: () => T
  deps: Array<Dep>
  options: ReactiveEffectOptions
  allowRecurse: boolean
}

export interface ReactiveEffectOptions {
  lazy?: boolean
  scheduler?: (job: ReactiveEffect) => void
  onTrack?: (event: DebuggerEvent) => void
  onTrigger?: (event: DebuggerEvent) => void
  onStop?: () => void
  allowRecurse?: boolean
}

export type DebuggerEvent = {
  effect: ReactiveEffect
  target: object
  type: TrackOpTypes | TriggerOpTypes
  key: any
} & DebuggerEventExtraInfo

export interface DebuggerEventExtraInfo {
  newValue?: any
  oldValue?: any
  oldTarget?: Map<any, any> | Set<any>
}

const effectStack: ReactiveEffect[] = [] // Effect 执行栈记录
let activeEffect: ReactiveEffect | undefined // 当前需要执行的Effect函数

export const ITERATE_KEY = Symbol(__DEV__ ? 'iterate' : '')
export const MAP_KEY_ITERATE_KEY = Symbol(__DEV__ ? 'Map key iterate' : '')

export function isEffect(fn: any): fn is ReactiveEffect {
  return fn && fn._isEffect === true
}

export function effect<T = any>(
  fn: () => T,
  options: ReactiveEffectOptions = EMPTY_OBJ
): ReactiveEffect<T> {
  //  如果传入的是提个effect 生成的函数 直接返回effect上挂载的用户传入的函数
  if (isEffect(fn)) {
    fn = fn.raw
  }
  // 创建一个响应式的effect函数
  const effect = createReactiveEffect(fn, options)
  if (!options.lazy) {
    // lazy 第一次默认是否执行
    effect()
  }
  return effect
}

export function stop(effect: ReactiveEffect) {
  if (effect.active) {
    cleanup(effect)
    if (effect.options.onStop) {
      effect.options.onStop()
    }
    effect.active = false
  }
}

let uid = 0

function createReactiveEffect<T = any>(
  fn: () => T,
  options: ReactiveEffectOptions
): ReactiveEffect<T> {
  // 创建一个effect响应式函数
  const effect = function reactiveEffect(): unknown {
    if (!effect.active) {
      // 非激活状态，则判断如果非调度执行，则直接执行原始函数。
      return options.scheduler ? undefined : fn()
    }
    if (!effectStack.includes(effect)) {
      // effect 依赖多个值的时候这多个值同时被修改都触会发effect, 判断如果执行栈里已经有了 就不会再次触发
      // 当前Effect 还在 栈记录里没有出栈 代表 当前Effect还没执行完又被执行了一次
      /**
       *  如 let effect1 = effect(() => { console.log(state.count);state.count ++ })
       *  effect1 执行的时候 state.count 又触发了 effect1执行 这样会形成死循环
       *  为了避免这种情况发生 如果当前effect 没有执行完成 不能再次执行
       */

      // 清空 effect 引用的依赖 重新进行收集 防止上一次依赖的值 这次可能不需要依赖
      cleanup(effect)

      // try finally 保证用户传进来的函数就算报错也能保持栈内的当前的记录没有问题
      try {
        enableTracking() // 开启依赖收集

        effectStack.push(effect) // effectStack 记录当前执行的effect
        activeEffect = effect // 激活当前执行的effect
        return fn() // 执行用户传入的fn
      } finally {
        // 用户的函数执行完成之后 将 effectStack 的自身记录删除
        effectStack.pop()
        resetTracking()

        // 修改当前激活的activeEffect
        activeEffect = effectStack[effectStack.length - 1]
      }
    }
  } as ReactiveEffect
  effect.id = uid++ // 增加唯一标识id
  effect.allowRecurse = !!options.allowRecurse
  effect._isEffect = true // 标识是一个响应式effect
  effect.active = true // 是否被激活
  effect.raw = fn // effect(fn) 执行的时候 传入的 用户函数
  effect.deps = [] // 存储收集依赖的
  effect.options = options
  return effect
}

function cleanup(effect: ReactiveEffect) {
  const { deps } = effect
  if (deps.length) {
    for (let i = 0; i < deps.length; i++) {
      deps[i].delete(effect)
    }
    deps.length = 0
  }
}

let shouldTrack = true
const trackStack: boolean[] = []

export function pauseTracking() {
  // 通过 shouldTrack标识 暂停依赖收集
  trackStack.push(shouldTrack)
  shouldTrack = false
}

export function enableTracking() {
  // 开启依赖收集
  trackStack.push(shouldTrack)
  shouldTrack = true
}

export function resetTracking() {
  const last = trackStack.pop()
  shouldTrack = last === undefined ? true : last
}

// 收集依赖
export function track(target: object, type: TrackOpTypes, key: unknown) {
  if (!shouldTrack || activeEffect === undefined) {
    return
  }
  // 在映射表里找到 当前的值有没有对应的effect
  let depsMap = targetMap.get(target)
  if (!depsMap) {
    // 如果当前值在映射表，没有找到对应的target记录
    // 就给映射表设置一条当前值的空记录
    // 如target = { a: 1, b: { c: 2 } }
    // 递归收集所有值的依赖后
    // 如 targetMap as WeakMap => { {a:1} as WeakMap.key : {} as Map }
    /**
     * { WeakMap
     *   {a:1,b:{c:2}}:   { Map
     *      a: [ effect1, effect2 ]  Set
     *      b: [ effect1 ]
     *   },
     *  {c: 2}:    { Map
     *      c: [ effect1, effect2 ]  Set
     *   },
     *
     *
     */
    targetMap.set(target, (depsMap = new Map()))
  }
  // 检查当前target【key】下是否有对应的Effect记录
  let dep = depsMap.get(key)
  if (!dep) {
    depsMap.set(key, (dep = new Set()))
  }
  // 如果当前值对应的Effect记录没有 当前effect, 则收集当前effect
  if (!dep.has(activeEffect)) {
    dep.add(activeEffect)
    // 当前Effect 也收集当前的值
    activeEffect.deps.push(dep)
    if (__DEV__ && activeEffect.options.onTrack) {
      activeEffect.options.onTrack({
        effect: activeEffect,
        target,
        type,
        key
      })
    }
  }
}

// 触发对应的 effect
export function trigger(
  target: object,
  type: TriggerOpTypes,
  key?: unknown,
  newValue?: unknown,
  oldValue?: unknown,
  oldTarget?: Map<unknown, unknown> | Set<unknown>
) {
  const depsMap = targetMap.get(target)
  // targetMap = {{a:1, b:1}: { a: [effect], b: [effect] }}
  // depsMap = { a: [effect], b: [effect] }
  // 在映射表里 查看当前的值 是否做过依赖收集
  // 如果没有直接return
  if (!depsMap) {
    // never been tracked
    return
  }

  // 存储需要执行的effect
  const effects = new Set<ReactiveEffect>()
  const add = (effectsToAdd: Set<ReactiveEffect> | undefined) => {
    // effectsToAdd => [effect1, effect2]
    if (effectsToAdd) {
      effectsToAdd.forEach(effect => {
        // 现在正在执行的effect 就是当前需要执行的effect 则不会加入到执行队列
        /**
          let state = reactive({age: 1})
          effect(effectFn1() => {
            state.age++
          })
          state.age++ 执行的之后会触发当前的 effectFn1
          activeEffect 就赋值为 effectFn1
          effectFn1 然后执行 里面的 state.age++
          这时候又触发了执行 effectFn1 === activeEffect
          所以要排除这种递归执行的情况 避免无限递归
        */
        if (effect !== activeEffect || effect.allowRecurse) {
          // 添加到执行队列里面
          effects.add(effect)
        }
      })
    }
  }

  if (type === TriggerOpTypes.CLEAR) {
    // collection being cleared
    // trigger all effects for target
    depsMap.forEach(add)
  } else if (key === 'length' && isArray(target)) {
    // 如果修改的是数组的长度， 需要通知数组的每一值对应的effect更新
    depsMap.forEach((dep, key) => {
      //  dep => [effect] Set
      // 如果修改长度 并且新长度小于原始长度 也要通知length 对应的 effect执行
      if (key === 'length' || key >= (newValue as number)) {
        // key>=newVal
        // arr = [1,2,3,4,5] 的length 修改为了3 那么只有下标大于 3的元素 才会触发对应的effect执行
        add(dep)
      }
    })
  } else {
    // schedule runs for SET | ADD | DELETE
    if (key !== void 0) {
      // 如果key存在 直接将这个key对应的effect添加到执行队列里
      add(depsMap.get(key))
    }

    // also run for iteration key on ADD | DELETE | Map.SET
    // 执行 iteration 的key 如 for in | for of | forEach
    switch (type) {
      // 新增属性
      case TriggerOpTypes.ADD:
        if (!isArray(target)) {
          // 如果不是数组
          /***
           *  对象在for in遍历的时候
           *  effect(() => {
           *    for(let key in obj) {  }
           * })
           * 由于读取了响应对象的值
           * 会针对for in 这个读取操作 为对象设置一个特殊的key作为标识 ITERATE_KEY 收集这个值的对应的effect
           * 当对对象进行添加新值的操作时 会触发 ITERATE_KEY 对应的 effect 如果只是修改, 则不会触发 因为遍历key 的数量不会变
           * delete 的时候同理
           *
           */
          add(depsMap.get(ITERATE_KEY))
          if (isMap(target)) {
            add(depsMap.get(MAP_KEY_ITERATE_KEY))
          }
        } else if (isIntegerKey(key)) {
          // new index added to array -> length changes
          // 如果新增了数组的一个索引 arr = [1, 2, 3]  arr[5] = 2  length也会发生改变
          // 触发length的的更新
          add(depsMap.get('length'))
        }
        break
      case TriggerOpTypes.DELETE:
        if (!isArray(target)) {
          add(depsMap.get(ITERATE_KEY))
          if (isMap(target)) {
            add(depsMap.get(MAP_KEY_ITERATE_KEY))
          }
        }
        break
      case TriggerOpTypes.SET:
        if (isMap(target)) {
          // 如果对 Map类型的值 进行修改 则触发 map对象 forEach 对应的effect
          // 因为forEach 执行时一般情况下会在意值是否改变
          add(depsMap.get(ITERATE_KEY))
        }
        break
    }
  }

  const run = (effect: ReactiveEffect) => {
    if (__DEV__ && effect.options.onTrigger) {
      // 触发 onTrigger 回调
      effect.options.onTrigger({
        effect,
        target,
        key,
        type,
        newValue,
        oldValue,
        oldTarget
      })
    }
    if (effect.options.scheduler) {
      // 如果配置项里面配置了 scheduler函数 就只调用 scheduler
      effect.options.scheduler(effect)
    } else {
      effect()
    }
  }

  // 执行需要执行的effect
  effects.forEach(run)
}
