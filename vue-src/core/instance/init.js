/* @flow */

import config from '../config'
import { initProxy } from './proxy'
import { initState } from './state'
import { initRender } from './render'
import { initEvents } from './events'
import { mark, measure } from '../util/perf'
import { initLifecycle, callHook } from './lifecycle'
import { initProvide, initInjections } from './inject'
import { extend, mergeOptions, formatComponentName } from '../util/index'
/*Github:https://github.com/answershuto*/
let uid = 0

/*initMixin就做了一件事情，在Vue的原型上增加_init方法，构造Vue实例的时候会调用这个_init方法来初始化Vue实例*/
export function initMixin (Vue: Class<Component>) {
  Vue.prototype._init = function (options?: Object) {
    const vm: Component = this
    // a uid
    // 组件唯一标识
    vm._uid = uid++

    let startTag, endTag
    /* istanbul ignore if */
    if (process.env.NODE_ENV !== 'production' && config.performance && mark) {
      startTag = `vue-perf-init:${vm._uid}`
      endTag = `vue-perf-end:${vm._uid}`
      mark(startTag)
    }

    // a flag to avoid this being observed
    /*一个防止vm实例自身被观察的标志位*/
    vm._isVue = true
    // merge options
    //合并 options
    // _isComponent 用于vue内部使用
    if (options && options._isComponent) {
      // optimize internal component instantiation
      // since dynamic options merging is pretty slow, and none of the
      // internal component options needs special treatment.
      //优化内部组件实例化
      //动态选择合并以来非常缓慢,并没有
      //内部组件选项需要特殊处理。
      initInternalComponent(vm, options)
    } else {
      // mergeOptions -> 定义在 core/util/options.js
      // 合并配置
      vm.$options = mergeOptions(
        // 当vm.constructor 为Vue 就是将用户配置的选项和Vue的内置选项合并 如 { components:{ keepAlive }}
        // 'components',
        //   'directives',
        //   'filters'
        resolveConstructorOptions(vm.constructor), // vm的构造函数就是vue 相当于把vue 作为参数传入 返回一个options
        options || {},   // options -> new Vue时传入的参数选项options  { el: '#app', data: function () { retuen {} } }
        vm
      )
    }
    /* istanbul ignore else */
    if (process.env.NODE_ENV !== 'production') {
      initProxy(vm)
    } else {
      vm._renderProxy = vm
    }
    // expose real self
    vm._self = vm
    /*初始化生命周期*/
    initLifecycle(vm)
    /*初始化事件*/
    initEvents(vm)
    /*初始化render*/
    initRender(vm)
    /*调用beforeCreate钩子函数并且触发beforeCreate钩子事件*/
    callHook(vm, 'beforeCreate')
    initInjections(vm) // resolve injections before data/props
    /*初始化props、methods、data、computed与watch*/
    initState(vm)
    initProvide(vm) // resolve provide after data/props
    /*调用created钩子函数并且触发created钩子事件*/
    callHook(vm, 'created')

    /* istanbul ignore if */
    if (process.env.NODE_ENV !== 'production' && config.performance && mark) {
      /*格式化组件名*/
      vm._name = formatComponentName(vm, false)
      mark(endTag)
      measure(`${vm._name} init`, startTag, endTag)
    }

    if (vm.$options.el) {
      /*挂载*/
      vm.$mount(vm.$options.el)
    }
  }
}

function initInternalComponent (vm: Component, options: InternalComponentOptions) {
  // 子组件构造器 在vue.extend 的时候创建的  并且将构造器 的options 合并到了实例的$options 
  // 子类构造器合并了 Vue的options 所以通过Vue全局注册的组件 指令等 子组件也能使用
  const opts = vm.$options = Object.create(vm.constructor.options)
  // doing this because it's faster than dynamic enumeration.
  opts.parent = options.parent  // 当前vm实例  如app组件 传过来的就是app组件的实例
  // 将占位vnode的options 合并到渲染vnode上
  opts.propsData = options.propsData
  opts._parentListeners = options._parentListeners
  opts._renderChildren = options._renderChildren
  opts._componentTag = options._componentTag

  // 传过来的就是当前组件的vnode 如渲染 App 组件 传过来的就是App的vnode
  //  一个占位 vnode
  // 例如 hello-world 组件
  // 那么 hello-world 这个组件什么时候渲染呢，
  // 在 App.vue 组件执行 patch 的过程中，遇到 hello-world 这个组件 vnode，
  // 就会走到 createComponent 逻辑，进而执行这个 vnode 的 init 的钩子函数，
  // 然后会实例化这个 hello-world 组件，执行它的 init 过程，
  // 并返回这个实例。然后执行这个实例的 $mount 方法，
  // 最后会执行这个子组件的 patch 过程，渲染子组件。
  // 一个组件有2个 vnode   vm.$vnode 为占位vnode  vm._vnode 为渲染vnode
  // 实际渲染组件  $vnode 和 _vnode 也可以是负责渲染
  // $vnode 负责占位  _vnode 负责在占位vnode中渲染
  // 由 core/vdom/create-component createComponentInstanceForVnode 方法传入

  opts._parentVnode = options._parentVnode
  opts._parentElm = options._parentElm
  opts._refElm = options._refElm
  if (options.render) {
    opts.render = options.render
    opts.staticRenderFns = options.staticRenderFns
  }
}

export function resolveConstructorOptions (Ctor: Class<Component>) {
  let options = Ctor.options
  /*如果存在父类的时候*/
  if (Ctor.super) {
    /* // 当vm.constructor 为Vue 就是将用户配置的选项和Vue的内置选项合并 如 { components:{ keepAlive }}
        // 'components',
        //   'directives',
        //   'filters'*/
    const superOptions = resolveConstructorOptions(Ctor.super)
    /*之前已经缓存起来的父类的options，用以检测是否更新*/
    const cachedSuperOptions = Ctor.superOptions
    /*对比当前父类的option以及缓存中的option，两个不一样则代表已经被更新*/
    if (superOptions !== cachedSuperOptions) {
      // super option changed,
      // need to resolve new options.
      /*父类的opiton已经被改变，需要去处理新的option*/

      /*把新的option缓存起来*/
      Ctor.superOptions = superOptions
      // check if there are any late-modified/attached options (#4976)
      const modifiedOptions = resolveModifiedOptions(Ctor)
      // update base extend options
      if (modifiedOptions) {
        extend(Ctor.extendOptions, modifiedOptions)
      }
      options = Ctor.options = mergeOptions(superOptions, Ctor.extendOptions)
      if (options.name) {
        options.components[options.name] = Ctor
      }
    }
  }
  return options
}

function resolveModifiedOptions (Ctor: Class<Component>): ?Object {
  let modified
  const latest = Ctor.options
  const extended = Ctor.extendOptions
  const sealed = Ctor.sealedOptions
  for (const key in latest) {
    if (latest[key] !== sealed[key]) {
      if (!modified) modified = {}
      modified[key] = dedupe(latest[key], extended[key], sealed[key])
    }
  }
  return modified
}

function dedupe (latest, extended, sealed) {
  // compare latest and sealed to ensure lifecycle hooks won't be duplicated
  // between merges
  if (Array.isArray(latest)) {
    const res = []
    sealed = Array.isArray(sealed) ? sealed : [sealed]
    extended = Array.isArray(extended) ? extended : [extended]
    for (let i = 0; i < latest.length; i++) {
      // push original options and not sealed options to exclude duplicated options
      if (extended.indexOf(latest[i]) >= 0 || sealed.indexOf(latest[i]) < 0) {
        res.push(latest[i])
      }
    }
    return res
  } else {
    return latest
  }
}
