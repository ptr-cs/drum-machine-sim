export const MELODY_ENABLED_VERSION = 1;

export function melodyEnabledForProject(project = {}) {
  if ((project.melodyEnabledVersion ?? 0) < MELODY_ENABLED_VERSION) return true;
  return project.melodyEnabled !== false;
}
