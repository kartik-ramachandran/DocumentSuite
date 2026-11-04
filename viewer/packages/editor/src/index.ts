import type { ViewerContext, ViewerPlugin } from '@pdf-suite/viewer';
import { AnnotationController } from './annotations';
import { FormController } from './forms';
import { ToolsController } from './tools';

export type { Annotation, AnnotationTool, Point, Rect } from './annotation-types';

export interface EditorPluginOptions {
  /** Enable the document tools panel, which needs the viewer's serviceUrl. Defaults to true. */
  tools?: boolean;
}

export interface EditorPlugin extends ViewerPlugin {
  /** Annotation controls. Available once the viewer has loaded the plugin. */
  readonly annotations: AnnotationController | null;
}

/** Adds annotations, form filling and the document tools to a viewer. */
export function createEditorPlugin(options: EditorPluginOptions = {}): EditorPlugin {
  let annotations: AnnotationController | null = null;
  let forms: FormController | null = null;

  return {
    name: 'editor',
    get annotations() {
      return annotations;
    },

    install(context: ViewerContext) {
      forms = new FormController(context);
      forms.install();

      annotations = new AnnotationController(context);
      annotations.install();

      const controller = annotations;
      context.addExportStep(async (bytes) => {
        const items = controller.getAnnotations();
        if (items.length === 0) return bytes;
        // The PDF writer is large, so it's only loaded when there's something to write.
        const { writeAnnotations } = await import('./pdf-export');
        return writeAnnotations(bytes, items);
      });

      if (options.tools !== false) new ToolsController(context, context.hasService).install();
    },

    destroy() {
      annotations?.destroy();
      forms?.destroy();
    },
  };
}
