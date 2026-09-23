import { addProtocol, removeProtocol } from 'maplibre-gl';
import { Protocol } from 'pmtiles';

/**
 * Registers the archive protocol with the renderer.
 *
 * Registration is global to the renderer, so it is reference counted: React's development
 * double-mount, or two maps on one page, must not leave the protocol unregistered while a map
 * is still using it.
 */
const PROTOCOL_SCHEME = 'pmtiles';

let registrations = 0;
let protocol: Protocol | undefined;

export function registerArchiveProtocol(): () => void {
  if (registrations === 0) {
    // `metadata: true` makes the adapter publish the archive's own TileJSON, including its
    // layer list and attribution, instead of a minimal stub.
    protocol = new Protocol({ metadata: true });
    addProtocol(PROTOCOL_SCHEME, protocol.tile);
  }
  registrations += 1;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    registrations -= 1;
    if (registrations === 0) {
      removeProtocol(PROTOCOL_SCHEME);
      protocol = undefined;
    }
  };
}

export function archiveProtocolRegistrations(): number {
  return registrations;
}
