/* @flow */
/*Github:https://github.com/answershuto*/
import config from '../config'
import Watcher from '../observer/watcher'
import { mark, measure } from '../util/perf'
import { createEmptyVNode } from '../vdom/vnode'
import { observerState } from '../observer/index'
import { updateComponentListeners } from './events'
import { resolveSlots } from './render-helpers/resolve-slots'

import {
  warn,
  noop,
  remove,
  handleError,
  emptyObject,
  validateProp
} from '../util/index'

export let activeInstance: any = null

/*初始化生命周期*/
export function initLifecycle (vm: Component) {
  const options = vm.$options

  // locate first non-abstract parent
  /* 将vm对象存储到parent组件中（保证parent组件是非抽象组件，比如keep-alive） */
  // 如app组件  在app patch 的过程中遇到子组件渲染 进入initLifecycle可以在这里直接获取父组件vm实例
  //  options.parent 在 core/vdom/create-component  createComponent  的过程中,
  // 执行了component的 data.hook.init方法 后 createComponentInstanceForVnode 方法中定义
  
  let parent = options.parent
  if (parent && !options.abstract) {
    // 一般组件会走这一部分
    // 建立父子关系
    // 抽象组件跳过父子关系 如 a -> b -> c  b是抽象组件 c的父组件就跳过b 是a
    while (parent.$options.abstract && parent.$parent) {
      parent = parent.$parent
    }
    // 在父组件中 push 子组件 如 app组件 中push（router-view）

    parent.$children.push(vm)
  }

  vm.$parent = parent
  vm.$root = parent ? parent.$root : vm

  vm.$children = []
  vm.$refs = {}

  vm._watcher = null
  vm._inactive = null
  vm._directInactive = false
  vm._isMounted = false
  vm._isDestroyed = false
  vm._isBeingDestroyed = false
}

export function lifecycleMixin (Vue: Class<Component>) {
  /*更新节点*/
  Vue.prototype._update = function (vnode: VNode, hydrating?: boolean) {
    const vm: Component = this
    /*如果已经该组件已经挂载过了则代表进入这个步骤是个更新的过程，触发beforeUpdate钩子*/
    if (vm._isMounted) {
      callHook(vm, 'beforeUpdate')
    }
    const prevEl = vm.$el
    const prevVnode = vm._vnode
    const prevActiveInstance = activeInstance //  每次调用_update更新视图时 先保存上一个vm 实例
    activeInstance = vm  // 会在每次path的过程中 把当前vm作为父级  vm实例 作为全局变量  传给子组件  每次patch 是一个深度优先遍历的过程
    vm._vnode = vnode
    // Vue.prototype.__patch__ is injected in entry points
    // based on the rendering backend used.
    /*基于后端渲染Vue.prototype.__patch__被用来作为一个入口*/
    if (!prevVnode) { // 首次渲染的时候 prevVnode 为空
      // initial render

      vm.$el = vm.__patch__(
        vm.$el, // 组件渲染的时候 vm.$el  为空
        vnode, hydrating, false /* removeOnly */,
        vm.$options._parentElm,
        vm.$options._refElm
      )
    } else {
      // updates
      // 定义在 platform -> runtime -> index
      vm.$el = vm.__patch__(prevVnode, vnode)
    }
    // patch 完成之后 还原当前实例
    activeInstance = prevActiveInstance
    // update __vue__ reference
    /*更新新的实例对象的__vue__*/
    if (prevEl) {
      prevEl.__vue__ = null
    }
    if (vm.$el) {
      vm.$el.__vue__ = vm
    }
    // if parent is an HOC, update its $el as well
    if (vm.$vnode && vm.$parent && vm.$vnode === vm.$parent._vnode) {
      vm.$parent.$el = vm.$el
    }
    // updated hook is called by the scheduler to ensure that children are
    // updated in a parent's updated hook.
  }

  Vue.prototype.$forceUpdate = function () {
    const vm: Component = this
    if (vm._watcher) {
      vm._watcher.update()
    }
  }

  Vue.prototype.$destroy = function () {
    const vm: Component = this
    if (vm._isBeingDestroyed) {
      return
    }
    /* 调用beforeDestroy钩子 */
    callHook(vm, 'beforeDestroy')
    /* 标志位 */
    vm._isBeingDestroyed = true
    // remove self from parent
    const parent = vm.$parent
    if (parent && !parent._isBeingDestroyed && !vm.$options.abstract) {
      remove(parent.$children, vm)
    }
    // teardown watchers
    /* 该组件下的所有Watcher从其所在的Dep中释放 */
    if (vm._watcher) {
      vm._watcher.teardown()
    }
    let i = vm._watchers.length
    while (i--) {
      vm._watchers[i].teardown()
    }
    // remove reference from data ob
    // frozen object may not have observer.
    if (vm._data.__ob__) {
      vm._data.__ob__.vmCount--
    }
    // call the last hook...
    vm._isDestroyed = true
    // invoke destroy hooks on current rendered tree
    vm.__patch__(vm._vnode, null)
    // fire destroyed hook
    /* 调用destroyed钩子 */
    callHook(vm, 'destroyed')
    // turn off all instance listeners.
    /* 移除所有事件监听 */
    vm.$off()
    // remove __vue__ reference
    if (vm.$el) {
      vm.$el.__vue__ = null
    }
    // remove reference to DOM nodes (prevents leak)
    vm.$options._parentElm = vm.$options._refElm = null
  }
}

/*挂载组件*/
export function mountComponent (
  vm: Component,
  el: ?Element,
  hydrating?: boolean
): Component {
  vm.$el = el
  if (!vm.$options.render) {
    /*render函数不存在的时候创建一个空的VNode节点*/
    vm.$options.render = createEmptyVNode
    if (process.env.NODE_ENV !== 'production') {
      /* istanbul ignore if */
      // 如果使用了template而不是render函数但是使用的runtime-only版本，就报这个警告
      // 如果使用了template 但是不是用的 compile 版本，也会报警告
      if ((vm.$options.template && vm.$options.template.charAt(0) !== '#') ||
        vm.$options.el || el) {
        warn(
          'You are using the runtime-only build of Vue where the template ' +
          'compiler is not available. Either pre-compile the templates into ' +
          'render functions, or use the compiler-included build.',
          vm
        )
      } else {
        // 如果没有render template 和 el 提示编译 错误
        warn(
          'Failed to mount component: template or render function not defined.',
          vm
        )
      }
    }
  }
  /*触发beforeMount钩子*/
  callHook(vm, 'beforeMount')

  /*updateComponent作为Watcher对象的getter函数，用来依赖收集*/
  let updateComponent
  /* istanbul ignore if */
  // 开发环境 开启了 性能埋点
  if (process.env.NODE_ENV !== 'production' && config.performance && mark) {
    updateComponent = () => {
      const name = vm._name
      const id = vm._uid
      const startTag = `vue-perf-start:${id}`
      const endTag = `vue-perf-end:${id}`

      mark(startTag)
      const vnode = vm._render()
      mark(endTag)
      measure(`${name} render`, startTag, endTag)

      mark(startTag)
      vm._update(vnode, hydrating)
      mark(endTag)
      measure(`${name} patch`, startTag, endTag)
    }
  } else {
    updateComponent = () => {
      // vm._render() 方法渲染出来一个 VNode
      //  vm._update 渲染真实dom
      vm._update(vm._render(), hydrating)
    }
  }

  /*这里对该vm注册一个Watcher实例，Watcher的getter为updateComponent函数，用于触发所有渲染所需要用到的数据的getter，进行依赖收集，该Watcher实例会存在所有渲染所需数据的闭包Dep中*/
  vm._watcher = new Watcher(vm, updateComponent, noop)
  hydrating = false

  // manually mounted instance, call mounted on self
  // mounted is called for render-created child components in its inserted hook
  if (vm.$vnode == null) {
    /*标志位，代表该组件已经挂载*/
    vm._isMounted = true
    /*调用mounted钩子*/
    callHook(vm, 'mounted')
  }
  return vm
}

export function updateChildComponent (
  vm: Component,
  propsData: ?Object,
  listeners: ?Object,
  parentVnode: VNode,
  renderChildren: ?Array<VNode>
) {
  // determine whether component has slot children
  // we need to do this before overwriting $options._renderChildren
  const hasChildren = !!(
    renderChildren ||               // has new static slots
    vm.$options._renderChildren ||  // has old static slots
    parentVnode.data.scopedSlots || // has new scoped slots
    vm.$scopedSlots !== emptyObject // has old scoped slots
  )

  vm.$options._parentVnode = parentVnode
  vm.$vnode = parentVnode // update vm's placeholder node without re-render
  if (vm._vnode) { // update child tree's parent
    vm._vnode.parent = parentVnode
  }
  vm.$options._renderChildren = renderChildren

  // update props
  if (propsData && vm.$options.props) {
    observerState.shouldConvert = false
    if (process.env.NODE_ENV !== 'production') {
      observerState.isSettingProps = true
    }
    const props = vm._props
    const propKeys = vm.$options._propKeys || []
    for (let i = 0; i < propKeys.length; i++) {
      const key = propKeys[i]
      props[key] = validateProp(key, vm.$options.props, propsData, vm)
    }
    observerState.shouldConvert = true
    if (process.env.NODE_ENV !== 'production') {
      observerState.isSettingProps = false
    }
    // keep a copy of raw propsData
    vm.$options.propsData = propsData
  }
  // update listeners
  if (listeners) {
    const oldListeners = vm.$options._parentListeners
    vm.$options._parentListeners = listeners
    updateComponentListeners(vm, listeners, oldListeners)
  }
  // resolve slots + force update if has children
  if (hasChildren) {
    vm.$slots = resolveSlots(renderChildren, parentVnode.context)
    vm.$forceUpdate()
  }
}

/*判断组件是否已经是active的*/
function isInInactiveTree (vm) {
  while (vm && (vm = vm.$parent)) {
    if (vm._inactive) return true
  }
  return false
}

/*使子组件状态都改编成active同时调用activated钩子*/
export function activateChildComponent (vm: Component, direct?: boolean) {
  if (direct) {
    vm._directInactive = false
    if (isInInactiveTree(vm)) {
      return
    }
  } else if (vm._directInactive) {
    return
  }
  if (vm._inactive || vm._inactive === null) {
    vm._inactive = false
    /*递归*/
    for (let i = 0; i < vm.$children.length; i++) {
      activateChildComponent(vm.$children[i])
    }
    /*触发actived钩子*/
    callHook(vm, 'activated')
  }
}

export function deactivateChildComponent (vm: Component, direct?: boolean) {
  if (direct) {
    vm._directInactive = true
    if (isInInactiveTree(vm)) {
      return
    }
  }
  if (!vm._inactive) {
    vm._inactive = true
    for (let i = 0; i < vm.$children.length; i++) {
      deactivateChildComponent(vm.$children[i])
    }
    callHook(vm, 'deactivated')
  }
}

/*调用钩子函数并且触发钩子事件*/
export function callHook (vm: Component, hook: string) {
  const handlers = vm.$options[hook]
  if (handlers) {
    for (let i = 0, j = handlers.length; i < j; i++) {
      try {
        handlers[i].call(vm)
      } catch (e) {
        handleError(e, vm, `${hook} hook`)
      }
    }
  }
  if (vm._hasHookEvent) {
    vm.$emit('hook:' + hook)
  }
}
