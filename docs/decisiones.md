# Decisiones y supuestos

No existe código reutilizable del panel anterior, así que la lógica de la Fase 1 se diseñó a partir del documento de especificación. Estos son los supuestos que conviene revisar con el uso real; casi todos se cambian en un solo archivo.

## Estados y etapas del episodio

`packages/core/src/episodes.ts`

- **Seis estados:** Planeado, Guion, Por grabar, En edición, Programado y Publicado. El documento nombra cinco; el sexto se asumió como **Planeado** (el episodio existe pero aún no empieza).
- **Nueve etapas** en la página del episodio: Planeación (previa a la dirección) más las ocho del documento. Cada etapa tiene un solo botón principal.
- Estado durante cada etapa: Planeación → Planeado; Dirección, Guion, Verificación → Guion; Preparación, Grabación → Por grabar; Publicación → En edición (Programado al vincular el video); Difusión, Evaluación → Publicado.
- Las acciones que dependen de IA (preguntas de dirección, guion, verificación, ayudas visuales) llegan en las Fases 2 y 3. Mientras tanto el botón aparece deshabilitado con la fase en que llega y se puede **marcar la etapa como hecha** a mano para no bloquear el flujo.
- Mover un episodio en el tablero lo ubica en la primera etapa de ese estado.
- **Avance automático:** al sincronizar, un video público pasa el episodio a Publicado y uno privado con fecha programada lo pasa a Programado. Nunca retrocede un episodio.
- Pegar el enlace del video deja el episodio en Programado (o Publicado, si la sincronización ya sabe que es público).
- El **editor de video** solo puede pasar un episodio entre Por grabar y En edición; la base de datos lo hace cumplir con un trigger además de la interfaz.

## Alertas y señales

`packages/core/src/thresholds.ts` (todos los umbrales en un solo lugar)

Alertas de Inicio:

| Alerta               | Cuándo                                                                      | Severidad                     |
| -------------------- | --------------------------------------------------------------------------- | ----------------------------- |
| Publicación vencida  | Fecha de publicación pasada y el episodio sigue antes de Programado         | Crítico                       |
| Sin guion a tiempo   | Se publica en ≤ 5 días y sigue en Planeado o Guion                          | Atención (Crítico a ≤ 2 días) |
| Grabación vencida    | Fecha de grabación pasada y sigue antes de En edición                       | Atención                      |
| Programado sin video | Estado Programado sin video vinculado                                       | Atención                      |
| Estancado            | 14 días sin cambiar de estado (antes de Programado)                         | Aviso                         |
| Meta sin cubrir      | Faltan episodios con fecha para la meta de esta semana y las dos siguientes | Crítico / Atención / Aviso    |

Señales del canal (Bien / Atención / Crítico), calculadas sin IA y **solo con la planificación**, no con cifras de YouTube, para no caer en la regla de métricas derivadas mientras no haya auditoría:

| Señal                            | Bien    | Atención | Crítico |
| -------------------------------- | ------- | -------- | ------- |
| Días desde la última publicación | < 8     | < 15     | ≥ 15    |
| Cobertura de la meta esta semana | ≥ 100 % | ≥ 50 %   | < 50 %  |
| Semanas de cola en producción    | ≥ 2     | ≥ 1      | 0       |
| Publicados a tiempo (8 semanas)  | ≥ 80 %  | ≥ 50 %   | < 50 %  |

**Racha:** semanas seguidas cumpliendo la meta de publicados. La semana en curso suma si ya se cumplió, pero no rompe la racha mientras no termine.

## Ideas

Cinco señales de 1 a 5: demanda, encaje con el canal, diferenciación, esfuerzo (invertido: menos esfuerzo puntúa más) y oportunidad. El puntaje es el promedio llevado a 0–100.

## Fechas y zona horaria

Las fechas de grabación y publicación se guardan como fechas locales del canal (`date`), no como instantes. El código del episodio es `PREFIJO-AAMMDD-HHMM` en la zona del canal (reemplaza el `GT-…` fijo en Bogotá). Las semanas empiezan en lunes.

## Fuera de la Fase 1

- Motor de tareas (Trigger.dev), créditos y todo lo que usa IA: Fase 2. La tabla `tasks` y `usage_ledger` ya existen.
- Pantalla completa de equipo y panel de administración con consumo: la Fase 1 trae lo mínimo para invitar, cambiar rol y quitar.
- Resumen semanal por correo, comentarios, boletín y analítica: Fase 4.
- Comentarios sobre párrafos del guion e historial con deshacer: con el editor de guion (Fase 2). El registro de quién cambió qué ya existe (`activity_log`).
