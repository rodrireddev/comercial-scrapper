// esbuild importa los .css del renderer como texto (loader "text") para usarlos dentro de Shadow DOM.
declare module '*.css' {
  const css: string;
  export default css;
}
