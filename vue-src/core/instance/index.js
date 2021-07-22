import { initMixin } from './init'
import { stateMixin } from './state'
import { renderMixin } from './render'
import { eventsMixin } from './events'
import { lifecycleMixin } from './lifecycle'
import { warn } from '../util/index'
/*Github:https://github.com/answershuto*/
function Vue (options) {
  if (process.env.NODE_ENV !== 'production' &&
    !(this instanceof Vue)) {
    warn('Vue is a constructor and should be called with the `new` keyword')
  }
  /*初始化*/
  // 定义在 core -> instance -> init
  this._init(options)
}

initMixin(Vue)  // 挂载 _init方法
stateMixin(Vue) // 重写 $data 和 $props 的get, 挂载了 $set  $delete $watch
eventsMixin(Vue)
lifecycleMixin(Vue)
renderMixin(Vue)

export default Vue
