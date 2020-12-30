/* @flow */

import * as nodeOps from 'web/runtime/node-ops' // 关于dom的一些操作方法
import { createPatchFunction } from 'core/vdom/patch'
import baseModules from 'core/vdom/modules/index'
import platformModules from 'web/runtime/modules/index'

// the directive module should be applied last, after all
// built-in modules have been applied.
//应该最后应用指令模块
//已应用内置模块
const modules = platformModules.concat(baseModules)  // 合并模块钩子函数

export const patch: Function = createPatchFunction({ nodeOps, modules })
