/// <reference types="vite/client" />

declare module "*.mp4?inline" {
  const src: string;
  export default src;
}

declare module "*.mp4" {
  const src: string;
  export default src;
}
