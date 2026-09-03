import { computed } from 'vue'

const noop = () => undefined

export const collabStub = {
  state: { value: { roomId: null, localName: '' } },
  remotePeers: computed(() => []),
  followingPeer: computed(() => null),
  connect: () => Promise.resolve(),
  disconnect: noop,
  shareCurrentDoc: () => '',
  updateCursor: noop,
  updateSelection: noop,
  setLocalName: noop,
  followPeer: noop,
  tickFollow: noop
}