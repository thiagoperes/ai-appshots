import type { CompositionSpec, DeviceLayer, PanoramaSpec } from './composition-types';
import type { ResolvedConfig, ScreenSpec, TargetSpec } from './types';
import { compositionLayers } from './render/presets.ts';
import { formFactorFor } from './devices.ts';

export interface CompositionJob {
  readonly screens: readonly ScreenSpec[];
  readonly sources: readonly ScreenSpec[];
  readonly composition?: CompositionSpec;
  readonly panorama?: PanoramaSpec;
}

export function mergeCompositions(...specs: readonly (CompositionSpec | undefined)[]): CompositionSpec | undefined {
  let merged: CompositionSpec | undefined;
  for (const spec of specs) {
    if (!spec) continue;
    const overrides = { ...merged?.overrides };
    for (const [id, override] of Object.entries(spec.overrides ?? {})) {
      overrides[id] = { ...overrides[id], ...override };
    }
    merged = {
      ...merged, ...spec,
      background: { ...merged?.background, ...spec.background },
      layers: [...(merged?.layers ?? []), ...(spec.layers ?? [])],
      overrides,
    };
  }
  return merged;
}

/** Plans whole panorama groups before any captures or writes occur. */
export function planCompositions(config: ResolvedConfig, target: TargetSpec, selected: readonly ScreenSpec[]): CompositionJob[] {
  const eligible = config.screens.filter((screen) => !screen.excludeTargets?.includes(target.id));
  const byId = new Map(config.screens.map((screen) => [screen.id, screen]));
  if (byId.size !== config.screens.length) throw new Error('Screen IDs must be unique.');
  const selectedIds = new Set(selected.map((screen) => screen.id));
  const memberships = new Map<string, PanoramaSpec>();
  const groupIds = new Set<string>();
  for (const group of config.panoramas ?? []) {
    if (groupIds.has(group.id)) throw new Error(`Duplicate panorama ID "${group.id}".`);
    groupIds.add(group.id);
    if (group.targets?.some((id) => !config.targets.some((candidate) => candidate.id === id))) {
      throw new Error(`Panorama "${group.id}" references an unknown target.`);
    }
    if (group.targets && !group.targets.includes(target.id)) continue;
    if (group.screens.length < 2 || group.screens.length > 10 || new Set(group.screens).size !== group.screens.length) {
      throw new Error(`Panorama "${group.id}" needs 2–10 distinct screens.`);
    }
    const indexes = group.screens.map((id) => {
      if (!byId.has(id)) throw new Error(`Panorama "${group.id}" references unknown screen "${id}".`);
      return eligible.findIndex((screen) => screen.id === id);
    });
    if (indexes.every((index) => index < 0)) continue;
    if (indexes.some((index, i) => index < 0 || (i > 0 && index !== indexes[i - 1]! + 1))) {
      throw new Error(`Panorama "${group.id}" must use consecutive screens in target "${target.id}" order.`);
    }
    for (const id of group.screens) {
      if (memberships.has(id)) throw new Error(`Screen "${id}" belongs to more than one panorama for "${target.id}".`);
      memberships.set(id, group);
    }
  }
  const completed = new Set<string>();
  const jobs: CompositionJob[] = [];
  for (const screen of eligible) {
    const panorama = memberships.get(screen.id);
    if (panorama && completed.has(panorama.id)) continue;
    const screens = panorama ? panorama.screens.map((id) => byId.get(id)!) : [screen];
    if (!screens.some((entry) => selectedIds.has(entry.id))) continue;
    if (panorama) completed.add(panorama.id);
    const composition = mergeCompositions(config.composition, target.composition,
      panorama ? panorama.composition : screen.composition);
    const ids = composition
      ? compositionLayers(composition, {
        screens: screens.map((entry) => entry.id), output: target.output,
        canvas: config.theme, theme: panorama?.theme ?? screen.theme, captionScale: target.captionScale,
        formFactor: formFactorFor(target), deviceSize: target.viewport,
      }).filter((layer): layer is DeviceLayer => !layer.hidden && layer.kind === 'device').map((layer) => layer.screen)
      : [screen.id];
    const sources = [...new Set(ids)].map((id) => {
      const source = byId.get(id);
      if (!source || source.excludeTargets?.includes(target.id)) {
        throw new Error(`Composition references unavailable screen "${id}" for "${target.id}".`);
      }
      return source;
    });
    jobs.push({ screens, sources, composition, panorama });
  }
  return jobs;
}
