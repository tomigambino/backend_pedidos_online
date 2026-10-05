# Roadmap

## A) Antes de desplegar
- [X] Registrar pedido manual desde el panel admin (botón/modal "Agregar pedido" en Gestión de Pedidos, reutilizando la creación de pedidos; backend primero y frontend después)
- [ ] Imprimir recibo/comanda del pedido para cocina o empaque/bolsa mediante hoja de estilos CSS (`@media print`) en el detalle del pedido en el panel de administración.
- [ ] Código QR con el enlace al menú público en la sección de configuración del admin (dentro de "Link del menú"), con vista previa en pantalla y botón para descargar en formato de imagen/PDF para cartelería del mostrador.
- [ ] Sistema de cupones de descuento (creación, límites de uso, fechas de validez, porcentaje o monto fijo y validación durante el checkout).
- [ ] Panel de estadísticas avanzadas con reportes de pedidos en formato tabla, incluyendo exportación y filtros combinables por rango de fechas, estado del pedido y cliente.
- [ ] Métodos de pago configurables con recargos o descuentos automáticos aplicables sobre el total de la orden según la opción elegida por el cliente (ej. descuento por transferencia/efectivo, recargo por tarjeta).

## B) Después de probarlo con clientes
- Conciliación bancaria automática con CVU único por pedido (Chytapay, Cucuru u otra herramienta)
- Control de stock con actualización automática por venta
- Extras en los pedidos (ej. agregar carne, cheddar)

---

Ver context/PENDING.md para deuda técnica y bugs conocidos