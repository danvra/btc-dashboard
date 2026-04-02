/// <reference types="vite/client" />

declare module "*.conf?raw" {
  const content: string;
  export default content;
}
