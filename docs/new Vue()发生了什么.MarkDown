## new Vue() 发生了什么

Vue 方法定义在 src/core/instance/index.js 文件下 

```javascript
function Vue (options) {
  if (process.env.NODE_ENV !== 'production' &&
    !(this instanceof Vue)
  ) {
    warn('Vue is a constructor and should be called with the `new` keyword')
  }
  // -> 由initMixin方法定义在原型上
  this._init(options)
}

initMixin(Vue)
stateMixin(Vue)
eventsMixin(Vue)
lifecycleMixin(Vue)
renderMixin(Vue)

export default Vue
```
由代码可以看出在 new Vue() 的时候 实际上执行的是 _init( ) 方法, 改方法是由initMixin拓展到Vue原型上, 定义在 src/core/instance/init.js 文件下


```javascript
let uid = 0

export function initMixin (Vue: Class<Component>) {
  Vue.prototype._init = function (options?: Object) {
    const vm: Component = this
    vm._uid = uid++

    let startTag, endTag
    /* istanbul ignore if */
    if (process.env.NODE_ENV !== 'production' && config.performance && mark) {
      startTag = `vue-perf-start:${vm._uid}`
      endTag = `vue-perf-end:${vm._uid}`
      mark(startTag)
    }
    vm._isVue = true
    // merge options
    if (options && options._isComponent) {
      initInternalComponent(vm, options)
    } else {
      
      vm.$options = mergeOptions(
        resolveConstructorOptions(vm.constructor),
        options || {},
        vm
      )
    }
    if (process.env.NODE_ENV !== 'production') {
      initProxy(vm)
    } else {
      vm._renderProxy = vm
    }
    vm._self = vm
    // 初始化生命周期
    initLifecycle(vm)
    // 初始化事件
    initEvents(vm)
    // 初始化render
    initRender(vm)
    // 执行beforeCreate钩子
    callHook(vm, 'beforeCreate')
    initInjections(vm) 
    // 初始化props、methods、data、computed与watch
    initState(vm)
    initProvide(vm) // resolve provide after data/props
    // 执行created钩子
    callHook(vm, 'created')

    if (process.env.NODE_ENV !== 'production' && config.performance && mark) {
 
      vm._name = formatComponentName(vm, false)
      mark(endTag)
      measure(`vue ${vm._name} init`, startTag, endTag)
    }

    if (vm.$options.el) {
      // 挂载节点
      vm.$mount(vm.$options.el)
    }
  }
}
```

该方法初始化了一系列的状态 生命周期 事件等, 最后由$mount方法挂载到dom上,首先主要看下initState里面发生了什么, 该方法定义在 src/core/instance/state.js 文件下

```javascript
export function initState (vm: Component) {
  vm._watchers = []
  const opts = vm.$options
  if (opts.props) initProps(vm, opts.props)
  if (opts.methods) initMethods(vm, opts.methods)
  if (opts.data) {
    initData(vm)
  } else {
    observe(vm._data = {}, true /* asRootData */)
  }
  if (opts.computed) initComputed(vm, opts.computed)
  if (opts.watch && opts.watch !== nativeWatch) {
    initWatch(vm, opts.watch)
  }
}
```

该方法主要进行computed props methods data 属性的初始化,我们先看initData

```javascript
function  initData (vm: Component) {
  let data = vm.$options.data
  data = vm._data = typeof data === 'function'
    ? getData(data, vm)
    : data || {}
  if (!isPlainObject(data)) {
    data = {}
    process.env.NODE_ENV !== 'production' && warn(
      'data functions should return an object:\n' +
      'https://vuejs.org/v2/guide/components.html#data-Must-Be-a-Function',
      vm
    )
  }
  // proxy data on instance
  const keys = Object.keys(data)
  const props = vm.$options.props
  const methods = vm.$options.methods
  let i = keys.length
  // 拿到methods 和props 跟data里面的属性对比 是否有相同的key
  // 在data里面声明了 就不能再methods 和 props 声明同样的 属性
  while (i--) {
    const key = keys[i]
    if (process.env.NODE_ENV !== 'production') {
      if (methods && hasOwn(methods, key)) {
        warn(
          `Method "${key}" has already been defined as a data property.`,
          vm
        )
      }
    }
    if (props && hasOwn(props, key)) {
      process.env.NODE_ENV !== 'production' && warn(
        `The data property "${key}" is already declared as a prop. ` +
        `Use prop default value instead.`,
        vm
      )
    } else if (!isReserved(key)) {
      // 属性代理
      // 将data methods props 代理到vm实例上
      proxy(vm, `_data`, key)
    }
  }
}
```
该方法是将option里的data处理且挂载到实例的_data属性上,如果data是个function, getData执行改方法并将data()里的this指向当前实例,所以在data()里面使用this的时候可以访问当前实例

后面进行了data props methods属性名的对比,最终data 和 methods props 里的户型都会挂载到vm实例上 所以key不能重复

最后进行了的proxy方法对data的上的状态进行代理

```javascript
export function proxy (target: Object, sourceKey: string, key: string) {
  // 属性代理
  sharedPropertyDefinition.get = function proxyGetter () {
    return this[sourceKey][key]
  }
  sharedPropertyDefinition.set = function proxySetter (val) {
    this[sourceKey][key] = val
  }
  Object.defineProperty(target, key, sharedPropertyDefinition)
}
```
从上面的代码可以看出其实就是通过Object.defineProperty方法将this._data.xx代理到this.xx上
所以使用者在使用的时候直接通过this.xx就可以访问this._data.xx上的值


