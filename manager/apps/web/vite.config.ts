import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import path from 'path';
import fs from 'fs';

// P4 CPA has its own release line; upstream subtree tags are not product versions.
function getVersion(): string {
  if (process.env.VERSION) return process.env.VERSION;
  const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf8'));
  return pkg.version;
}

const isDemoSiteBuild = (mode: string) =>
  mode === 'demo' || process.env.DEMO_SITE === 'true' || process.env.VITE_DEMO_SITE === 'true';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const demoSite = isDemoSiteBuild(mode);
  const useRealDemoFixtures = demoSite || mode === 'test';

  return {
    plugins: [
      react(),
      viteSingleFile({
        removeViteModuleLoader: true,
      }),
    ],
    define: {
      __APP_VERSION__: JSON.stringify(getVersion()),
      __DEMO_SITE__: JSON.stringify(demoSite || mode === 'test'),
    },
    resolve: {
      alias: [
        {
          find: /^@\/features\/demo\/demoFixtures$/,
          replacement: path.resolve(
            __dirname,
            useRealDemoFixtures
              ? './src/features/demo/demoFixtures.ts'
              : './src/features/demo/demoFixtures.empty.ts'
          ),
        },
        {
          find: '@',
          replacement: path.resolve(__dirname, './src'),
        },
      ],
    },
    css: {
      modules: {
        localsConvention: 'camelCase',
        generateScopedName: '[name]__[local]___[hash:base64:5]',
      },
      preprocessorOptions: {
        scss: {
          additionalData: `@use "@/styles/variables" as *;\n@use "@/styles/mixins" as *;\n`,
        },
      },
    },
    build: {
      target: 'es2020',
      outDir: demoSite ? 'dist-demo' : 'dist',
      assetsInlineLimit: 100000000,
      chunkSizeWarningLimit: 100000000,
      cssCodeSplit: false,
      rolldownOptions: {
        output: {
          codeSplitting: false,
        },
      },
    },
  };
});
