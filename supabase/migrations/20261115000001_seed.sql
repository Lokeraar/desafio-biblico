-- =====================================================================
-- Banco inicial: 25 preguntas de Selección simple (2 Corintios)
-- Fuente: cuestionario del concurso, fase 2. Texto de referencia: LBLA.
--
-- Correcciones aplicadas sobre el original:
--   * N.º 18 «Porque la letra mata, pero el Espíritu da»: el documento
--     marcaba B (Gozo) pero su propio texto decía «Vida», y 2 Co 3:6
--     (LBLA) dice «el Espíritu da vida». Fijada en C (Vida).
-- =====================================================================

insert into public.questions (game_slug, prompt, options, correct_option, reference, source) values
  ('seleccion-simple','¿A Quién envió Dios para consolar a Pablo con su llegada?','[{"k": "a", "t": "Timoteo"}, {"k": "b", "t": "Tito"}, {"k": "c", "t": "Pedro"}, {"k": "d", "t": "Silas"}]'::jsonb,'b','2 Corintios 7:6','seed'),
  ('seleccion-simple','¿Cuál es el título de 2 Corintios 1:1?','[{"k": "a", "t": "Aflicciones de Pablo"}, {"k": "b", "t": "Salutación"}, {"k": "c", "t": "Pablo perdona al ofensor"}, {"k": "d", "t": "Visita a Corinto"}]'::jsonb,'b',null,'seed'),
  ('seleccion-simple','Según 2 de Corintios 8: 9 ¿Quién era rico y se hizo pobre?','[{"k": "a", "t": "Abraham"}, {"k": "b", "t": "Lázaro"}, {"k": "c", "t": "Jesús"}, {"k": "d", "t": "Apolo"}]'::jsonb,'c',null,'seed'),
  ('seleccion-simple','¿Como describió Pablo a Dios?','[{"k": "a", "t": "Dios de toda Consolación"}, {"k": "b", "t": "Dios de Ira"}, {"k": "c", "t": "Dios de Gracia"}, {"k": "d", "t": "Dios Padre vuestro"}]'::jsonb,'a','2 Corintios 1:3','seed'),
  ('seleccion-simple','¿Por quiénes ha sido predicado el hijo de Dios, Jesucristo, según Pablo?','[{"k": "a", "t": "Pablo y Juan"}, {"k": "b", "t": "Silvano y Pedro"}, {"k": "c", "t": "Pedro, Silvano y Pablo"}, {"k": "d", "t": "Pablo, Silvano y Timoteo"}]'::jsonb,'d','2 Corintios 1:19','seed'),
  ('seleccion-simple','Según 2 Corintios 9:10 ¿Qué suministra Dios al Sembrador?','[{"k": "a", "t": "Agua y Crecimiento"}, {"k": "b", "t": "Semilla y Pan"}, {"k": "c", "t": "Lluvia y Roció"}, {"k": "d", "t": "Tierra y Sol"}]'::jsonb,'b',null,'seed'),
  ('seleccion-simple','¿Qué se dijo acerca de las promesas de Dios en 2 Corintios 1:20?','[{"k": "a", "t": "Somos salvos"}, {"k": "b", "t": "Las promesas son sí y son amén"}, {"k": "c", "t": "Es Cristo quien nos redime"}, {"k": "d", "t": "Serán completas cuando venga Cristo"}]'::jsonb,'b',null,'seed'),
  ('seleccion-simple','¿Qué hizo Pablo con respecto a Tito?','[{"k": "a", "t": "No tuvo reposo en su espíritu por no haberlo encontrado"}, {"k": "b", "t": "Lo visitó cuando estaba enfermo"}, {"k": "c", "t": "Le predicó para que se convirtiera a Cristo"}, {"k": "d", "t": "Todas las anteriores."}]'::jsonb,'a','2 Corintios 2:12-13','seed'),
  ('seleccion-simple','¿Qué no debemos ignorar como cristianos?','[{"k": "a", "t": "Las enseñanzas de los apóstoles"}, {"k": "b", "t": "Las enseñanzas del Espíritu"}, {"k": "c", "t": "Las maquinaciones de satanás"}, {"k": "d", "t": "Las tentaciones de la carne"}]'::jsonb,'c','2 Corintios 2:11','seed'),
  ('seleccion-simple','¿Quién no es aprobado por Dios?:','[{"k": "a", "t": "El que se ama"}, {"k": "b", "t": "El que llora"}, {"k": "c", "t": "El que se alaba"}, {"k": "d", "t": "El que pelea"}]'::jsonb,'c','2 Corintios 10:18','seed'),
  ('seleccion-simple','¿Qué se nos dice acerca de las cartas de recomendación de Pablo?','[{"k": "a", "t": "Las dejó en Troas"}, {"k": "b", "t": "Las envió con Timoteo"}, {"k": "c", "t": "No son necesarias, ya que es un apóstol de Jesucristo"}, {"k": "d", "t": "Las cartas son las mismas personas de Corinto"}]'::jsonb,'d','2 Corintios 3:2','seed'),
  ('seleccion-simple','Pablo nos exhorta a no recibir en vano:','[{"k": "a", "t": "La misericordia de Dios"}, {"k": "b", "t": "La obra de Dios"}, {"k": "c", "t": "El espíritu de Dios"}, {"k": "d", "t": "La Gracia de Dios"}]'::jsonb,'d','2 Corintios 6:1','seed'),
  ('seleccion-simple','Según 2 corintios 10: 4 nuestras armas son fuertes para destrucción:','[{"k": "a", "t": "De Fortalezas"}, {"k": "b", "t": "De Fuerzas del mal"}, {"k": "c", "t": "Del Diablo"}, {"k": "d", "t": "De las obras del Diablo"}]'::jsonb,'a',null,'seed'),
  ('seleccion-simple','Pablo dijo que cuando estaba presente era humilde, pero cuando estaba ausente era:','[{"k": "a", "t": "Humilde"}, {"k": "b", "t": "Preocupado"}, {"k": "c", "t": "Osado"}, {"k": "d", "t": "Diligente"}]'::jsonb,'c','2 Corintios 10:1','seed'),
  ('seleccion-simple','2 corintios 6:16 dice que acuerdo tiene el templo de Dios con:','[{"k": "a", "t": "Carne"}, {"k": "b", "t": "Fe"}, {"k": "c", "t": "Espíritu"}, {"k": "d", "t": "Ídolos"}]'::jsonb,'d',null,'seed'),
  ('seleccion-simple','Pablo aconseja no unirnos en yugo desigual con:','[{"k": "a", "t": "Incrédulos"}, {"k": "b", "t": "Fariseos"}, {"k": "c", "t": "Hipócritas"}, {"k": "d", "t": "Publicanos"}]'::jsonb,'a','2 Corintios 6:14','seed'),
  ('seleccion-simple','Pablo dijo: nadie me tenga por…','[{"k": "a", "t": "Mentiroso"}, {"k": "b", "t": "Loco"}, {"k": "c", "t": "Insensato"}, {"k": "d", "t": "Amigo"}]'::jsonb,'c','2 Corintios 11:16','seed'),
  ('seleccion-simple','Porque la letra mata, pero el Espíritu da:','[{"k": "a", "t": "Alegría"}, {"k": "b", "t": "Gozo"}, {"k": "c", "t": "Vida"}, {"k": "d", "t": "Paz"}]'::jsonb,'c','2 Corintios 3:6','seed'),
  ('seleccion-simple','¿Cuántas veces Pablo fue azotado con varas?','[{"k": "a", "t": "1 vez"}, {"k": "b", "t": "2 veces"}, {"k": "c", "t": "3 veces"}, {"k": "d", "t": "4 veces"}]'::jsonb,'c','2Corintios 11:25','seed'),
  ('seleccion-simple','¿Según Pablo con que deben saludarse los hermanos?','[{"k": "a", "t": "Con la mano"}, {"k": "b", "t": "Con un abrazo"}, {"k": "c", "t": "Con un beso santo"}, {"k": "d", "t": "Con una reverencia"}]'::jsonb,'c','2 Corintios 13 :12','seed'),
  ('seleccion-simple','¿Cuántas veces náufrago Pablo?','[{"k": "a", "t": "1 vez"}, {"k": "b", "t": "2 veces"}, {"k": "c", "t": "3 veces"}, {"k": "d", "t": "4 veces"}]'::jsonb,'c','2 Corintios 11 :25','seed'),
  ('seleccion-simple','¿Pablo fue usado por Dios para anunciar el evangelio a:','[{"k": "a", "t": "Los Gentiles"}, {"k": "b", "t": "El pueblo de Dios"}, {"k": "c", "t": "Los hebreos"}, {"k": "d", "t": "Los sacerdotes"}]'::jsonb,'a',null,'seed'),
  ('seleccion-simple','¿Cuántos azotes recibió Pablo de los Judíos (2 Corintios 11:24):','[{"k": "a", "t": "50"}, {"k": "b", "t": "39"}, {"k": "c", "t": "40"}, {"k": "d", "t": "20"}]'::jsonb,'b',null,'seed'),
  ('seleccion-simple','¿Pablo era descendiente de (2 Corintios 11:22):','[{"k": "a", "t": "Moisés"}, {"k": "b", "t": "Esaú"}, {"k": "c", "t": "David"}, {"k": "d", "t": "Abraham"}]'::jsonb,'d',null,'seed'),
  ('seleccion-simple','¿Las cosas viejas son:','[{"k": "a", "t": "Borradas"}, {"k": "b", "t": "Cambian"}, {"k": "c", "t": "Se botan"}, {"k": "d", "t": "Pasaron"}]'::jsonb,'d','2 corintios 5: 17','seed');

-- Comprobación rápida:
--   select count(*) from public.questions;  -- 25
