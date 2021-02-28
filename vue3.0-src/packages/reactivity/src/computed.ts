import { effect, ReactiveEffect, trigger, track } from './effect'
import { TriggerOpTypes, TrackOpTypes } from './operations'
import { Ref } from './ref'
import { isFunction, NOOP } from '@vue/shared'
import { ReactiveFlags, toRaw } from './reactive'

export interface ComputedRef<T = any> extends WritableComputedRef<T> {
  readonly value: T
}

export interface WritableComputedRef<T> extends Ref<T> {
  readonly effect: ReactiveEffect<T>
}

export type ComputedGetter<T> = (ctx?: any) => T
export type ComputedSetter<T> = (v: T) => void

export interface WritableComputedOptions<T> {
  get: ComputedGetter<T>
  set: ComputedSetter<T>
}

class ComputedRefImpl<T> {
  private _value!: T
  private _dirty = true

  public readonly effect: ReactiveEffect<T>

  public readonly __v_isRef = true;
  public readonly [ReactiveFlags.IS_READONLY]: boolean

  constructor(
    getter: ComputedGetter<T>,
    private readonly _setter: ComputedSetter<T>,
    isReadonly: boolean
  ) {
    // 创建一个响应effect
    this.effect = effect(getter, {
      lazy: true, // 第一次不触发effect
      scheduler: () => {
        // 如果依赖的值发生了改变 触发了这个effect改变
        //  this._dirty 设置为 true
        // 并且触发conputed 的set
        if (!this._dirty) {
          this._dirty = true
          trigger(toRaw(this), TriggerOpTypes.SET, 'value')
        }
      }
    })

    this[ReactiveFlags.IS_READONLY] = isReadonly
  }

  get value() {
    // 如果依赖被改变了 重新获取新值
    if (this._dirty) {
      this._value = this.effect() // 触发响应的effect 求值并且进行依赖收集 
      this._dirty = false
    }
    // 收集依赖
    track(toRaw(this), TrackOpTypes.GET, 'value')
    return this._value
  }

  set value(newValue: T) {
    this._setter(newValue)
  }
}

export function computed<T>(getter: ComputedGetter<T>): ComputedRef<T>
export function computed<T>(
  options: WritableComputedOptions<T>
): WritableComputedRef<T>


export function computed<T>(
  getterOrOptions: ComputedGetter<T> | WritableComputedOptions<T>
) {
  // 创建getter 和 setter
  let getter: ComputedGetter<T>
  let setter: ComputedSetter<T>

  if (isFunction(getterOrOptions)) {
    // 如果getterOrOptions 是个函数 直接设置getter
    getter = getterOrOptions
    setter = __DEV__
      ? () => {
          console.warn('Write operation failed: computed value is readonly')
        }
      : NOOP
  } else {
    getter = getterOrOptions.get
    setter = getterOrOptions.set
  }

  // 返回computed实例
  return new ComputedRefImpl(
    getter,
    setter,
    isFunction(getterOrOptions) || !getterOrOptions.set
  ) as any
}
