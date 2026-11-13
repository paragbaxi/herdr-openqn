// Stand-in for the "herdr" module, so files that import it (state.js) load under node --test.
export const shared = () => null;
export const setShared = () => {};
export const readTextFile = async () => "";
export const appHome = () => "/tmp/herdr-app-test";
export const home = () => "/tmp";
export const terminals = () => [];
export const agents = () => [];
export const spaces = () => [];
export const focused = () => null;
export const exec = async () => ({ code: 0, stdout: "", stderr: "" });
export const hc = async () => ({ code: 0, stdout: "", stderr: "" });
export const notify = () => {};
export const run = () => null;
export const theme = () => ({});
export const layout = () => ({});
export const nextCommand = () => new Promise(() => {});
