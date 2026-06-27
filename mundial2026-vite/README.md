# Copa Mundial FIFA 2026 — App

Creada y desarrollada por [KREVIK](https://krevik.ar)

## Instalación local

```bash
npm install
npm run dev
```

Abrí http://localhost:5173

## Deploy en Vercel

```bash
npm install -g vercel
vercel --prod
```

O arrastrá la carpeta `dist/` a [netlify.com/drop](https://netlify.com/drop) después de:

```bash
npm run build
```

## APIs utilizadas

- **ESPN 1 API** — Scores en tiempo real, cuotas DraftKings, canales de TV
  - `site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard`
- **FIFA 1 API v3** — Formaciones, alineaciones con coords, goleadores, fotos de jugadores
  - `api.fifa.com/api/v3` · idCompetition=17 · idSeason=285023

Ambas gratuitas, sin API key requerida.

## Funcionalidades

- Resultados del día con estado en tiempo real (pre/en vivo/final)
- Filtro por fases: Hoy / Todos / Grupos / R32 / Octavos / Cuartos / Semis / Final
- Tablas de posiciones con DG, GF, GC y resultados WC reales
- Llave del torneo con equipos tentativos calculados desde tablas
- Goleadores del torneo vía FIFA API
- Stats de partido: estadísticas, cuotas, incidencias
- Formación visual (cancha SVG) con jugadores reales de FIFA API
- En Vivo con countdown al próximo partido
- 100% en español · Auto-refresh 30s en vivo / 90s normal
