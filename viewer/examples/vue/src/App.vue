<script setup>
import { PdfViewer } from '@pdf-suite/vue';
import { createEditorPlugin } from '@pdf-suite/editor';
import { markRaw, onMounted, ref, watchEffect } from 'vue';

// Query parameters let the same demo run every mode: ?mode=server&transport=json&editor=0
const params = new URLSearchParams(location.search);

const plugin = params.get('editor') === '0' ? null : markRaw(createEditorPlugin());

const options = markRaw({
  mode: params.get('mode') ?? 'client',
  serviceUrl: params.get('service') ?? 'http://localhost:8080',
  serviceTransport: params.get('transport') ?? 'multipart',
  plugins: plugin ? [plugin] : [],
});

const source = ref(params.get('source') ?? undefined);
const component = ref();
onMounted(() => {
  watchEffect(() => {
    if (component.value?.viewer) Object.assign(window, { pdfViewer: component.value.viewer, pdfPlugin: plugin, setDemoSource: (value) => { source.value = value; } });
  });
});
</script>

<template>
  <PdfViewer ref="component" :source="source" :options="options" />
</template>
