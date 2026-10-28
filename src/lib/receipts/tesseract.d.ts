// tesseract.js is loaded lazily (dynamic import) so the bundle and the
// build never depend on it; this declaration lets TypeScript accept the
// import before the package is installed in node_modules.
declare module 'tesseract.js';
