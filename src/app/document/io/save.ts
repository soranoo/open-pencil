import { ref } from 'vue'

import type { EditorState } from '@open-pencil/core/editor'

import { downloadBlob } from '@/app/document/io/browser'
import { documentNameFromFigPath } from '@/app/document/io/names'
import { chooseBrowserFigSaveHandle, chooseTauriFigSavePath } from '@/app/document/io/save-targets'
import type { DocumentSourceIdentity } from '@/app/document/io/types'
import { createDocumentWriter } from '@/app/document/io/write'
import { IS_BACKEND_MODE, IS_TAURI } from '@/constants'

type SaveDocumentState = EditorState & { documentName: string }

type SaveActionsOptions = {
  state: SaveDocumentState
  buildFigFile: () => Uint8Array | Promise<Uint8Array>
  getFilePath: () => string | null
  setFilePath: (path: string | null) => void
  getFileHandle: () => FileSystemFileHandle | null
  setFileHandle: (handle: FileSystemFileHandle | null) => void
  getDownloadName: () => string | null
  setDownloadName: (name: string | null) => void
  setSourceIdentity: (identity: DocumentSourceIdentity) => void
  setSavedVersion: (version: number) => void
  setLastWriteTime: (time: number) => void
  startWatchingFile: () => void
}

export const isSaving = ref<boolean>(false)

export function createSaveActions({
  state,
  buildFigFile,
  getFilePath,
  setFilePath,
  getFileHandle,
  setFileHandle,
  getDownloadName,
  setDownloadName,
  setSourceIdentity,
  setSavedVersion,
  setLastWriteTime,
  startWatchingFile
}: SaveActionsOptions) {
  const writeFile = createDocumentWriter({
    state,
    getFilePath,
    getFileHandle,
    setSavedVersion,
    setLastWriteTime
  })

  async function saveToBackend(preferDebounced: boolean): Promise<boolean> {
    const bridge = window.openPencilServer
    if (!bridge) return false
    if (preferDebounced && bridge.saveDebounced) {
      await bridge.saveDebounced()
      return true
    }
    if (bridge.save) {
      await bridge.save()
      return true
    }
    return false
  }

  async function saveFigFile() {
    isSaving.value = true
    if (IS_BACKEND_MODE) {
      const versionToSave = state.sceneVersion
      const saved = await saveToBackend(true)
      if (!saved)
        throw new Error('Backend mode requires openPencilServer save bridge to be available')
      setSavedVersion(versionToSave)
    } else {
      const filePath = getFilePath()
      const fileHandle = getFileHandle()
      const downloadName = getDownloadName()
      if (filePath || fileHandle) {
        const wrote = await writeFile(await buildFigFile())
        if (wrote) setSourceIdentity({ handle: fileHandle, path: filePath })
      } else if (downloadName) {
        downloadBlob(new Uint8Array(await buildFigFile()), downloadName, 'application/octet-stream')
      } else {
        await saveFigFileAs()
      }
    }
    isSaving.value = false
  }

  async function saveFigFileAs() {
    if (IS_BACKEND_MODE) {
      const versionToSave = state.sceneVersion
      const saved = await saveToBackend(false)
      if (!saved)
        throw new Error('Backend mode requires openPencilServer save bridge to be available')
      setSavedVersion(versionToSave)
      return
    }

    const data = await buildFigFile()

    if (IS_TAURI) {
      const path = await chooseTauriFigSavePath()
      if (!path) return
      setFilePath(path)
      setFileHandle(null)
      state.documentName = documentNameFromFigPath(path)
      if (await writeFile(data)) setSourceIdentity({ handle: null, path })
      startWatchingFile()
      return
    }

    if (window.showSaveFilePicker) {
      const handle = await chooseBrowserFigSaveHandle()
      if (!handle) return
      setFileHandle(handle)
      setFilePath(null)
      state.documentName = documentNameFromFigPath(handle.name)
      if (await writeFile(data)) setSourceIdentity({ handle, path: null })
      startWatchingFile()
      return
    }

    const filename = prompt('Save as:', getDownloadName() ?? 'Untitled.fig')
    if (!filename) return
    setDownloadName(filename)
    state.documentName = documentNameFromFigPath(filename)
    downloadBlob(new Uint8Array(data), filename, 'application/octet-stream')
  }

  return { saveFigFile, saveFigFileAs, writeFile }
}
