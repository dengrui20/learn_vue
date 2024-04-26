import { ErrorCodes, callWithErrorHandling } from './errorHandling'
import { isArray } from '@vue/shared'
import { ComponentPublicInstance } from './componentPublicInstance'

export interface SchedulerJob {
  (): void
  /**
   * unique job id, only present on raw effects, e.g. component render effect
   */
  id?: number
  /**
   * Indicates whether the job is allowed to recursively trigger itself.
   * By default, a job cannot trigger itself because some built-in method calls,
   * e.g. Array.prototype.push actually performs reads as well (#1740) which
   * can lead to confusing infinite loops.
   * The allowed cases are component update functions and watch callbacks.
   * Component update functions may update child component props, which in turn
   * trigger flush: "pre" watch callbacks that mutates state that the parent
   * relies on (#1801). Watch callbacks doesn't track its dependencies so if it
   * triggers itself again, it's likely intentional and it is the user's
   * responsibility to perform recursive state mutation that eventually
   * stabilizes (#1727).
   */
  allowRecurse?: boolean
}

export type SchedulerCb = Function & { id?: number }
export type SchedulerCbs = SchedulerCb | SchedulerCb[]

let isFlushing = false
let isFlushPending = false

// 异步任务队列
const queue: SchedulerJob[] = []
let flushIndex = 0

// 队列任务执行完后执行的回调函数队列
const pendingPreFlushCbs: SchedulerCb[] = []
let activePreFlushCbs: SchedulerCb[] | null = null
let preFlushIndex = 0

const pendingPostFlushCbs: SchedulerCb[] = []
let activePostFlushCbs: SchedulerCb[] | null = null
let postFlushIndex = 0

const resolvedPromise: Promise<any> = Promise.resolve()
let currentFlushPromise: Promise<void> | null = null

let currentPreFlushParentJob: SchedulerJob | null = null

const RECURSION_LIMIT = 100
type CountMap = Map<SchedulerJob | SchedulerCb, number>

export function nextTick(
  this: ComponentPublicInstance | void,
  fn?: () => void
): Promise<void> {
  const p = currentFlushPromise || resolvedPromise
  return fn ? p.then(this ? fn.bind(this) : fn) : p
}

// 异步更新队列
export function queueJob(job: SchedulerJob) {
  // the dedupe search uses the startIndex argument of Array.includes()
  // by default the search index includes the current job that is being run
  // so it cannot recursively trigger itself again.
  // if the job is a watch() callback, the search will start with a +1 index to
  // allow it recursively trigger itself - it is the user's responsibility to
  // ensure it doesn't end up in an infinite loop.
  // 如果更新队列为空 或者 该队列不存在当前的更新effect
  // 将该effect 推入更新队列

  if (
    (!queue.length ||
      !queue.includes(
        job,
        isFlushing && job.allowRecurse ? flushIndex + 1 : flushIndex
        // 如果允许递归 则index + 1 从下一个开始检索 允许递归触发自己
        /**
        比如执行某个job的时候因为某种原因有触发了这个job 如果
        从flushIndex检索会发现已经存在不会再添加到任务队列里
        比如在父组件更新了响应式数据 a   a作为props传个子组件 子组件监听了props 设置了watch
        watch-cb 回调触发了修改父组件的依赖数据 a
        
        父组件更新数据时父组件的渲染update 
        ****** queue = [ parent-update ]
        开始执行queue队列 更新父组件
        父组件更新的过程中也更新了组组件的props  由于props是响应的
        触发了子组件的pre-watch ，pre-watch的回调cb会推入到pre-queue
        在子组件 添加一个pre类型的watch
         ****** queue = [ parent-update ]
                pre-queue = [ watch-cb ]
        父组件再更新props时(执行updateComponentPreRender) 会同步的执行并情况pre-queue队列(flushPreFlushCbs)
        这时就会执行watch-cb 
        然后触发回调cb 由于回调cb里修改了父组件的依赖数据 则又会把父组件的upate推入queue队列
        ****** queue = [ parent-update ] <-  parent-update
                pre-queue = [ watch-cb ]
        但是这个时候 父组件的parent-update还未执行完成 整个队列还未清空(整个异步队列执行完成才会清空)
        但是parent-update已经再队列中不会添加
        这样会导致父组件不更新 不符合预期
        */
      )) &&
    job !== currentPreFlushParentJob
  ) {
    // 如果更新队列为空, 或者queue不包含这个job 就加入队列
    // 如果已经包含了 就不加入队列 防止一个tick里多次更新
    queue.push(job)
    // 执行更新队列
    queueFlush()
  }
}

// 异步执行队列
function queueFlush() {
  if (!isFlushing && !isFlushPending) {
    // 等待清空
    isFlushPending = true
    // 异步执行更新队列
    currentFlushPromise = resolvedPromise.then(flushJobs)
  }
}

export function invalidateJob(job: SchedulerJob) {
  const i = queue.indexOf(job)
  if (i > -1) {
    queue.splice(i, 1)
  }
}

// 添加到回调队列
// queueCb(cb, activePreFlushCbs, pendingPreFlushCbs, preFlushIndex)
function queueCb(
  cb: SchedulerCbs,
  activeQueue: SchedulerCb[] | null,
  pendingQueue: SchedulerCb[],
  index: number
) {
  if (!isArray(cb)) {
    if (
      !activeQueue ||
      !activeQueue.includes(
        cb,
        (cb as SchedulerJob).allowRecurse ? index + 1 : index
      )
    ) {
      // 直接添加到对应的队列中去
      pendingQueue.push(cb)
    }
  } else {
    // if cb is an array, it is a component lifecycle hook which can only be
    // triggered by a job, which is already deduped in the main queue, so
    // we can skip duplicate check here to improve perf
    // 如果cb是个数组 处理拍平成一个一维数组
    pendingQueue.push(...cb)
  }
  queueFlush()
}

// 添加到pre队列
export function queuePreFlushCb(cb: SchedulerCb) {
  queueCb(cb, activePreFlushCbs, pendingPreFlushCbs, preFlushIndex)
}

// 添加到post队列
export function queuePostFlushCb(cb: SchedulerCbs) {
  queueCb(cb, activePostFlushCbs, pendingPostFlushCbs, postFlushIndex)
}

// 执行pre 队列
export function flushPreFlushCbs(
  seen?: CountMap,
  parentJob: SchedulerJob | null = null
) {
  if (pendingPreFlushCbs.length) {
    currentPreFlushParentJob = parentJob

    activePreFlushCbs = [...new Set(pendingPreFlushCbs)]
    pendingPreFlushCbs.length = 0
    if (__DEV__) {
      seen = seen || new Map()
    }
    for (
      preFlushIndex = 0;
      preFlushIndex < activePreFlushCbs.length;
      preFlushIndex++
    ) {
      if (__DEV__) {
        checkRecursiveUpdates(seen!, activePreFlushCbs[preFlushIndex])
      }
      activePreFlushCbs[preFlushIndex]()
    }
    activePreFlushCbs = null
    preFlushIndex = 0
    currentPreFlushParentJob = null
    // recursively flush until it drains
    flushPreFlushCbs(seen, parentJob)
  }
}

export function flushPostFlushCbs(seen?: CountMap) {
  if (pendingPostFlushCbs.length) {
    // 复制一份postcbs后清空
    // 可能某些回调函数的执行会再次修改 postFlushCbs，
    // 所以拷贝一个副本循环遍历则不会受到 postFlushCbs 修改的影响
    const deduped = [...new Set(pendingPostFlushCbs)]
    pendingPostFlushCbs.length = 0

    // #1947 already has active queue, nested flushPostFlushCbs call
    // 如果已经有正在执行的postCb 说明嵌套 postCb 执行  直接添加到正在执行的队列
    if (activePostFlushCbs) {
      activePostFlushCbs.push(...deduped)
      return
    }

    activePostFlushCbs = deduped
    if (__DEV__) {
      seen = seen || new Map()
    }

    activePostFlushCbs.sort((a, b) => getId(a) - getId(b))

    for (
      postFlushIndex = 0;
      postFlushIndex < activePostFlushCbs.length;
      postFlushIndex++
    ) {
      // 循环执行对应的回调
      if (__DEV__) {
        checkRecursiveUpdates(seen!, activePostFlushCbs[postFlushIndex])
      }
      activePostFlushCbs[postFlushIndex]()
    }
    activePostFlushCbs = null
    postFlushIndex = 0
  }
}

const getId = (job: SchedulerJob | SchedulerCb) =>
  job.id == null ? Infinity : job.id

// 清空异步任务
function flushJobs(seen?: CountMap) {
  isFlushPending = false
  isFlushing = true
  if (__DEV__) {
    seen = seen || new Map()
  }

  // 在更新之前 执行preflushcbs里的 回调
  flushPreFlushCbs(seen)

  // Sort queue before flush.
  // This ensures that:
  // 1. Components are updated from parent to child. (because parent is always
  //    created before the child so its render effect will have smaller
  //    priority number)
  // 2. If a component is unmounted during a parent component's update,
  //    its update can be skipped.
  // 保证更新顺序 先父后子
  // 组件从父级更新到子级。（因为父级总是在子级之前创建的，所以其渲染效果的优先级会更小）
  // 如果在父组件更新期间卸载了组件，则可以跳过其更新
  queue.sort((a, b) => getId(a) - getId(b))
  try {
    for (flushIndex = 0; flushIndex < queue.length; flushIndex++) {
      const job = queue[flushIndex]
      if (job) {
        if (__DEV__) {
          // 非生产环境下检测是否有循环更新
          checkRecursiveUpdates(seen!, job)
        }
        // 调用渲染effect 执行异步任务
        callWithErrorHandling(job, null, ErrorCodes.SCHEDULER)
      }
    }
  } finally {
    // 执行完之后 清空更新队列
    flushIndex = 0
    queue.length = 0
    // 更新完成之后 执行postcbs里的回调
    flushPostFlushCbs(seen)

    isFlushing = false
    currentFlushPromise = null
    // some postFlushCb queued jobs!
    // keep flushing until it drains.
    if (queue.length || pendingPostFlushCbs.length) {
      // 一些 postFlushCb 执行过程中会再次添加异步任务，递归 flushJobs 会把它们都执行完毕
      flushJobs(seen)
    }
  }
}

function checkRecursiveUpdates(seen: CountMap, fn: SchedulerJob | SchedulerCb) {
  // 检测循环更新
  // 每次flushjobs 一开始就创建了一个seen
  // flushcbs的时候会往seen中添加， 记录计数 count 如果在一个tick内
  // 添加超过 RECURSION_LIMIT 的次数就会警告
  if (!seen.has(fn)) {
    seen.set(fn, 1)
  } else {
    const count = seen.get(fn)!
    if (count > RECURSION_LIMIT) {
      throw new Error(
        `Maximum recursive updates exceeded. ` +
          `This means you have a reactive effect that is mutating its own ` +
          `dependencies and thus recursively triggering itself. Possible sources ` +
          `include component template, render function, updated hook or ` +
          `watcher source function.`
      )
    } else {
      seen.set(fn, count + 1)
    }
  }
}
