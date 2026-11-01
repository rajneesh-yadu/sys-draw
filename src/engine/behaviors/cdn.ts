/**
 * cdn (S10 geo): the node runs at edge PoPs next to every user region, so users reach it over
 * their last mile only; a miss travels from the PoP to the origin's region. With origins in
 * several regions, misses go to the nearest healthy one. Hit/miss itself is the `cache` behavior
 * (a CDN lists both).
 */
import { defineBehavior } from './types';

export const behavior = defineBehavior({
  id: 'cdn',
  placement: 'edge',
  geoRoutes: true,
});
