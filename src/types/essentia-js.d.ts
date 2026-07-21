declare module "essentia.js/dist/essentia-wasm.es.js" {
  export const EssentiaWASM: unknown;
}

declare module "essentia.js/dist/essentia.js-core.es.js" {
  const Essentia: unknown;
  export default Essentia;
}

declare module "essentia.js/dist/essentia.js-model.es.js" {
  export class EssentiaTFInputExtractor {
    constructor(wasmModule: unknown, modelName: "musicnn");
    computeFrameWise(audio: Float32Array): unknown;
  }
  export class TensorflowMusiCNN {
    constructor(tf: typeof import("@tensorflow/tfjs"), modelUrl: string);
    initialize(): Promise<void>;
    predict(inputFeature: unknown, zeroPadding?: boolean): Promise<number[][]>;
  }
}
