/**
 * MY-Suite 核心行（裸包名行）的宿主半边。
 * 合集是纯客户端插件：宿主侧无事可做，存在的意义是让
 * dsh-client-modules 把共享浏览器 bundle 挂到本行；关掉本行即整体停用。
 */
export function apply() {}
