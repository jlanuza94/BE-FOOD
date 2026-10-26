# BE Food · Aplicación de control

Aplicación para el celular que controla la planta de BE Food: órdenes entre áreas con cuatro cantidades
(pedida, aprobada, entregada y recibida), inventario por lote con etiqueta QR, cuarentena y liberación por
Calidad, FIFO/FEFO automático, fórmulas versionadas, producción por etapas con merma, trazabilidad,
conteo cíclico, avisos y auditoría. Nada se borra.

Esta es la **Etapa 1** del documento "La aplicación de control, explicada paso a paso".

## Cómo está hecha

- **Pantallas:** React + Vite, como app web instalable en Android (PWA), en español y con botones grandes.
- **Base de datos:** Supabase (Postgres en la nube, usuarios, fotos y copias de seguridad).
- **Las reglas viven en la base de datos.** Cada acción (aprobar, entregar, liberar, cerrar producción…) es
  una función en `supabase/migrations` que revisa el rol de quien la hace y las reglas del documento.
  La app solo puede leer las tablas; así nadie se salta una regla, aunque use otra herramienta.

## Ponerla en marcha (una sola vez)

1. **Crear la base de datos.** Entre a [supabase.com](https://supabase.com), cree una cuenta gratis y un
   proyecto nuevo (región *East US*). Guarde la contraseña que le pide.
2. **Cargar las reglas.** En Supabase abra **SQL Editor**, pegue el contenido de cada archivo de
   `supabase/migrations/` **en orden** (001, 002, 003… hasta el último) y presione **Run** en cada uno.
3. **Usuarios sin confirmar correo.** En **Authentication → Sign In / Providers → Email**, apague
   *Confirm email*. Así los trabajadores entran sin revisar su correo.
4. **Copiar las llaves.** En **Project Settings → API** copie *Project URL* y la llave *anon public*.
5. **Publicar la app.** Entre a [vercel.com](https://vercel.com) con su cuenta de GitHub, importe el
   repositorio `be-food` y en *Environment Variables* agregue:
   - `VITE_SUPABASE_URL` = la Project URL
   - `VITE_SUPABASE_ANON_KEY` = la llave anon public

   Presione **Deploy**. Vercel le da una dirección como `be-food.vercel.app`.
6. **Instalar en el celular.** Abra esa dirección en Chrome de Android y toque **⋮ → Agregar a la
   pantalla principal**.

## Primeros pasos dentro de la app

1. **La primera persona que crea su usuario queda como Gerencia.** Hágalo usted primero.
2. En **Menú → Catálogos** agregue las ubicaciones (silos, bodegas), los proveedores y los productos:
   materia prima (en libras), empaque (sacos vacíos) y alimento terminado (con el peso del saco).
3. En **Menú → Fórmulas** cree la receta de cada alimento.
4. Cada trabajador crea su usuario desde la pantalla de entrada. Usted lo activa y le da su rol en
   **Menú → Usuarios**. Si alguien no tiene correo, puede usar uno inventado como `pedro@befood.ni`.

## El recorrido de un pedido

| Paso | Quién | Dónde |
| --- | --- | --- |
| Pedir la compra | Inventario | Menú → Compras |
| Aprobar la compra | Gerencia | Inicio → Órdenes de compra por aprobar |
| Recibir con báscula y foto (queda en cuarentena) | Bodega / Inventario | Menú → Recibir materia prima |
| Liberar o rechazar | Calidad | Menú → Calidad |
| Pedir producción | Jefe de Producción | Menú → Producción |
| Aprobar producción (crea la orden de materia prima) | Gerencia | Producción |
| Aprobar cantidades (aparta lotes por FEFO/FIFO) | Inventario | Órdenes |
| Entregar | Bodega | Órdenes |
| Recibir (si no cuadra, motivo obligatorio) | Jefe de Producción | Órdenes |
| Revisión, etapas, envasado | Operador | Producción |
| Liberar el producto terminado | Calidad | Calidad |
| Cerrar con los sacos que salieron (calcula merma) | Jefe de Producción | Producción |
| Entregar y recibir sacos en bodega | Producción → Bodega | Órdenes |

## Avisos diarios

La migración 003 programa `revisar_alertas()` todos los días a las 6:00 a.m. (vencimientos a 30, 15 y 7 días,
cuarentena sin revisar, stock mínimo, órdenes detenidas, proveedores con muchos rechazos). Los demás avisos
salen en el momento. Las reglas que se pueden cambiar (merma permitida, días de cuarentena, etc.) están en
**Menú → Catálogos**.

## Para programadores

```bash
npm install
cp .env.example .env.local   # ponga la URL y la llave de Supabase
npm run dev
```

- `npm run build` revisa los tipos y compila.
- `npm run test:db` prueba todas las reglas en un Postgres local
  (`PGHOST=/tmp PGPORT=5432 PGUSER=postgres npm run test:db`). Recorre el pedido completo y revisa que
  cada bloqueo funcione.

## Lo que viene

- **Etapa 2:** costo por saco y ganancia, ventas, despacho, cobros y pagos a proveedores.
- **Etapa 3:** caja y bancos, flujo de caja, planilla, mantenimiento.
- **Etapa 4:** reportes para socios, avisos al teléfono, portal de clientes.
- Pendiente para más adelante: modo sin internet, lector de QR con la cámara, exportar a Excel/PDF y reprocesos.
