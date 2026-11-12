// 'No Sheet connected yet': the server answers with an empty, titleless meta that was still
// stamped as loaded (an unreachable source has an empty loadedAt). One rule for every page.
export function isNoSource(core) {
  const m = core.sourceMeta;
  return m.title === "" && m.url === "" && m.loadedAt !== "";
}
