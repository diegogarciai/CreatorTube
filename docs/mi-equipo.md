# «Mi equipo»: diseño

Diego registra sus dispositivos (dron, portátil, cámara, gadgets), propios o de marcas, para que:

- las ideas de episodios los tengan en cuenta (videos sobre ellos o que los usan);
- cada episodio diga qué equipo sale y con qué se grabó;
- la descripción de YouTube liste ese equipo.

## Decisiones

- **Por canal**, como la competencia o las redes. Lo maneja quien tiene `manage_episodes`; lo ve todo el canal.
- **Origen del equipo:**
  - propio;
  - **prestado** por una marca, con fecha de devolución y aviso si no hay video antes;
  - **regalo** de una marca;
  - **patrocinado**.

  Lo que viene de una marca lleva la aclaración de contenido patrocinado que pide YouTube.

- **Dos papeles en un episodio:**
  - **protagonista:** el video es sobre ese equipo;
  - **herramienta:** se usó para grabarlo.
- **Carga:**
  - un formulario con foto, en `{canal}/gear/` del bucket;
  - o una lista pegada que Claude ordena en marca, modelo y categoría (tarea `gear_parse`, etapa Ideas, unos 2 créditos). Esos equipos quedan **por revisar** y nada entra activo sin que alguien lo confirme.

## Pasos (cada uno en su PR)

| Paso | Qué                                                                                                       | Estado |
| ---- | --------------------------------------------------------------------------------------------------------- | ------ |
| 1    | Inventario: tabla `gear`, sección «Mi equipo», formulario con foto, lista pegada con Claude y revisión    | Hecho  |
| 2    | Ideas con el equipo (Claude propone episodios con él) y aviso de préstamos por devolver en Inicio         | Hecho  |
| 3    | Equipo en cada episodio (protagonista o herramienta), bloque para la descripción y aclaración en el guion | Hecho  |

## Lo que suma a las ideas (paso 2)

- **Reseñas a largo plazo** («6 meses después»), con la antigüedad de cada equipo.
- **Comparativas** entre equipos que el canal ya tiene.
- **Tutoriales y pruebas propias,** que la competencia no puede copiar.
- **Préstamos con fecha cercana:** el momento sube.
- **«Sin video todavía»:** los equipos que nunca salieron en un episodio.

## En cada episodio (paso 3)

- **Resumen › «Equipo del episodio»:** se agrega cada equipo como protagonista o herramienta.
  - Al arrancar un episodio desde una idea, sus equipos entran como protagonistas.
  - El botón de imagen copia la foto de un protagonista a las fotos del producto, para las miniaturas.
- **Publicación › «Equipo en la descripción»:** un bloque para copiar (`gearDescriptionBlock`) con:
  - lo que se reseñó y con qué se grabó;
  - los enlaces de afiliado;
  - la aclaración de lo que vino de una marca (`gearDisclosure`);
  - el aviso de afiliados.
- **Guion:** la ficha de entrada recibe el equipo, con el aviso de que el presentador lo tiene a mano para pruebas propias.
  - Si algo vino de una marca, el guion lo aclara al inicio y la descripción lo incluye.
  - En Publicación, el bloque va tal cual al final de la descripción.
- **«Mi equipo»:** dice en cuántos episodios sale cada equipo y permite filtrar los que no tienen video.
- **Inicio:** el aviso de préstamos ya no aparece cuando el equipo protagoniza un episodio publicado.
