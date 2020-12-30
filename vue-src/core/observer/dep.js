/* @flow */

import type Watcher from './watcher'
import { remove } from '../util/index'

let uid = 0
/*Github:https://github.com/answershuto*/
/**
 * A dep is an observable that can have multiple
 * directives subscribing to it.removeSub
 */
export default class Dep {
  // target 当前正在计算的watcher
  static target: ?Watcher;
  id: number;
  // subs 保存所有的watcher
  subs: Array<Watcher>;

  constructor () {
    this.id = uid++
    this.subs = []
  }

  /*添加一个观察者对象*/
  addSub (sub: Watcher) {
    this.subs.push(sub)
  }

  /*移除一个观察者对象*/
  removeSub (sub: Watcher) {
    remove(this.subs, sub)
  }

  /*依赖收集，当存在Dep.target的时候添加观察者对象*/
  depend () {
    if (Dep.target) {
      // 调用当前watcher的 addDep方法
      Dep.target.addDep(this)
    }
  }

  /*通知所有订阅者*/
  notify () {
    // stabilize the subscriber list first
    const subs = this.subs.slice()
    for (let i = 0, l = subs.length; i < l; i++) {
      subs[i].update()
    }
  }
}

// the current target watcher being evaluated.
// this is globally unique because there could be only one
// watcher being evaluated at any time.
/*依赖收集完需要将Dep.target设为null，防止后面重复添加依赖。*/
Dep.target = null // 当前的渲染watcher
const targetStack = []

/*将watcher观察者实例设置给Dep.target，用以依赖收集。同时将该实例存入target栈中*/
export function pushTarget (_target: Watcher) {
  // 首次渲染时 执行 mountComponent -> new Watcher  -> constructor -> this.get() -> pushTarget(this)
  // 渲染子组件的watcher的时候 如果存在父级的watcher 先将父级的target 保存在栈内
  // 然后将Dep.target 指向当前渲染的watcher
  if (Dep.target) targetStack.push(Dep.target)
  Dep.target = _target
}

/*将观察者实例从target栈中取出并设置给Dep.target*/
export function popTarget () {
  // 自组件的watcher 执行完了 之后 将父级的watcher 从堆栈内取出 再指向Dep.target
  // 和组件渲染是 activeIntance 类似 一层套一层
  Dep.target = targetStack.pop()
}
