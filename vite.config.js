import { copyFileSync, cpSync, createReadStream, existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const projectRoot = dirname(fileURLToPath(import.meta.url))
const regionCatalogSource = resolve(
  projectRoot,
  'node_modules/@countrystatecity/countries-browser/dist',
)

function regionCatalogPlugin() {
  return {
    name: 'token-killer-region-catalog',
    configureServer(server) {
      server.middlewares.use('/region-data', (request, response, next) => {
        let relativePath
        try {
          relativePath = decodeURIComponent(String(request.url || '').split('?')[0])
            .replace(/^\/+/, '')
        } catch {
          next()
          return
        }

        const sourcePath = resolve(regionCatalogSource, relativePath)
        if (
          !sourcePath.startsWith(`${regionCatalogSource}${sep}`) ||
          !existsSync(sourcePath) ||
          !statSync(sourcePath).isFile()
        ) {
          next()
          return
        }

        response.setHeader('Content-Type', 'application/json; charset=utf-8')
        createReadStream(sourcePath).pipe(response)
      })
    },
    closeBundle() {
      const targetRoot = resolve(projectRoot, 'dist/region-data')
      const targetData = resolve(targetRoot, 'data')
      mkdirSync(targetRoot, { recursive: true })
      cpSync(resolve(regionCatalogSource, 'data'), targetData, { recursive: true })
      copyFileSync(
        resolve(projectRoot, 'node_modules/@countrystatecity/countries-browser/LICENSE'),
        resolve(targetRoot, 'LICENSE'),
      )
    },
  }
}

export default defineConfig({
  plugins: [react(), regionCatalogPlugin()],
  base: './',
})
