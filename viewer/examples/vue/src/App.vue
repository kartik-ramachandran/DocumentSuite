<script setup>
import { FileList, PdfViewer, SettingsPanel } from '@pdf-suite/vue';
import { createEditorPlugin } from '@pdf-suite/editor';
import { markRaw, onMounted, ref, shallowRef, watchEffect } from 'vue';
import { applyDemoSettings, demoPanelOptions } from '../../shared/demo-settings';
import { createSampleFiles, filesFromInput } from '../../shared/sample-files';

// Query parameters let the same demo run every mode: ?view=viewer&mode=server&transport=json&editor=0&rename=1
const params = new URLSearchParams(location.search);
const panelOptions = demoPanelOptions(params.get('service') ?? 'http://localhost:8080');
applyDemoSettings();
const isViewerDemo = params.get('view') === 'viewer';

const plugin = params.get('editor') === '0' ? null : markRaw(createEditorPlugin());

const options = markRaw({
  mode: params.get('mode') ?? undefined,
  serviceUrl: params.get('service') ?? 'http://localhost:8080',
  serviceTransport: params.get('transport') ?? 'multipart',
  plugins: plugin ? [plugin] : [],
});

const source = ref(params.get('source') ?? undefined);
const component = ref();
const files = shallowRef([]);

const listOptions = markRaw({
  viewer: options,
  menuItems: [{
    id: 'remove',
    label: 'Remove from list',
    danger: true,
    separator: true,
    onSelect: (file) => {
      files.value = files.value.filter((item) => item !== file);
    },
  }],
});

function addFiles(event) {
  files.value = [...files.value, ...filesFromInput(event.target.files)];
}

onMounted(() => {
  if (!isViewerDemo) {
    void createSampleFiles().then((samples) => {
      files.value = samples;
    });
    return;
  }
  watchEffect(() => {
    if (component.value?.viewer) Object.assign(window, { pdfViewer: component.value.viewer, pdfPlugin: plugin, setDemoSource: (value) => { source.value = value; } });
  });
});
</script>

<template>
  <PdfViewer v-if="isViewerDemo" ref="component" :source="source" :options="options" />
  <main v-else style="max-width: 900px; margin: 32px auto; padding: 0 16px; font-family: system-ui, sans-serif">
    <h1 style="font-size: 22px">Your files</h1>
    <p>Click a file to open it, or right-click it for more actions.</p>
    <p><label>Add files <input type="file" multiple aria-label="Add files" @change="addFiles" /></label></p>
    <details style="margin-bottom: 16px">
      <summary style="cursor: pointer; font-weight: 600">Settings</summary>
      <div style="margin-top: 12px"><SettingsPanel :options="panelOptions" /></div>
    </details>
    <FileList :files="files" :options="listOptions" />
  </main>
</template>
