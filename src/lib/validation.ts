import { z } from "zod";
import { phoneSchema } from "./profile";
// An optional contact may be blank, but invalid numbers must keep the phone
// validator's useful message instead of a union's generic "Invalid input".
const phoneOrBlankSchema = z.string().trim().transform((value, context) => {
  if (value === "") return "";
  const parsed = phoneSchema.safeParse(value);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      context.addIssue({ code: "custom", message: issue.message, path: issue.path });
    }
    return z.NEVER;
  }
  return parsed.data;
});
export const objectId = z
  .string()
  .regex(/^[a-f\d]{24}$/i, "Identificador inválido");
export const vehicleSchema = z.strictObject({
  model: z.string().trim().min(2).max(80),
  plate: z
    .string()
    .trim()
    .transform((v) => v.replace(/[^a-z0-9]/gi, "").toUpperCase())
    .pipe(z.string().regex(/^[A-Z]{3}\d[A-Z\d]\d{2}$/, "Placa inválida")),
  type: z.enum(["small", "suv", "pickup", "moto"]),
});
export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(`${v}T12:00:00Z`);
    return !isNaN(+d) && d.toISOString().slice(0, 10) === v;
  }, "Data inválida");
const amount = z
  .number()
  .min(0)
  .max(1000000)
  .refine(
    (v) => Math.abs(Math.round(v * 100) - v * 100) < 0.000001,
    "Use no máximo duas casas decimais",
  );
export const bookingSchema = z.strictObject({
  requestId: z.uuid().optional(),
  serviceId: objectId,
  vehicle: vehicleSchema,
  scheduledAt: z.iso.datetime({ offset: true }),
  notes: z.string().trim().max(1000).default(""),
  couponId: objectId.optional(),
  consent: z.literal(true),
});
// Serviço à parte ("Outros"): descrição livre e valor definido por quem cadastra.
export const customServiceSchema = z.strictObject({
  description: z.string().trim().min(2, "Descreva o serviço").max(200),
  price: amount,
});
export const manualBookingSchema = bookingSchema
  .omit({ consent: true, serviceId: true })
  .extend({
    serviceId: objectId.optional(),
    custom: customServiceSchema.optional(),
    userId: objectId.optional(),
    guestName: z.string().trim().min(2).max(120).optional(),
    guestPhone: phoneOrBlankSchema.optional(),
    walkIn: z.boolean().optional(),
    scheduledAt: z.iso.datetime({ offset: true }).optional(),
    estimatedCompletionAt: z.iso.datetime({ offset: true }).optional(),
  })
  .refine((v) => !!v.userId || !!v.guestName, "Informe cliente ou nome avulso")
  .refine((v) => !!v.walkIn || !!v.scheduledAt, "Informe o horário ou registre uma chegada sem agendamento")
  .refine((v) => !!v.walkIn || !!v.estimatedCompletionAt, "Informe a previsão de entrega para confirmar o agendamento manual.")
  .refine(
    (v) => !!v.serviceId !== !!v.custom,
    "Escolha um serviço da lista ou informe um serviço à parte (Outros)",
  )
  .refine(
    (v) => !(v.custom && v.couponId),
    "Cupom não vale para serviço à parte",
  );
export const actionSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("return"), reason: z.string().trim().min(5, "Informe o motivo da devolução.").max(500) }),
  z.strictObject({
    action: z.literal("confirm"),
    estimatedCompletionAt: z.iso.datetime({ offset: true, error: "Informe a previsão de entrega para aprovar o agendamento." }),
  }),
  z.strictObject({
    action: z.enum(["reject", "cancel", "arrive", "start", "ready", "deliver"]),
    reason: z.string().trim().max(500).optional(),
  }),
  z.strictObject({
    action: z.literal("complete"),
    finalPrice: amount,
    paymentMethod: z.enum(["pix", "cash", "card"]),
  }),
  z.strictObject({
    action: z.literal("reschedule"),
    scheduledAt: z.iso.datetime({ offset: true }),
    estimatedCompletionAt: z.iso.datetime({ offset: true }).optional(),
  }),
]);
export const serviceSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    slug: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .max(100),
    category: z.enum(["wash", "extra"]),
    prices: z.object({ small: amount, suv: amount, pickup: amount, moto: amount.optional() }).nullable(),
    countsForLoyalty: z.boolean(),
    active: z.boolean(),
    imageUrl: z.string().max(200000).default("").refine(v => !v || /^https:\/\//.test(v) || /^\/(?!\/)/.test(v) || /^data:image\/(jpeg|png|webp);base64,/.test(v), "Imagem inválida"),
    vehicleTypes: z.array(z.enum(["small", "suv", "pickup", "moto"])).optional(),
    description: z.string().trim().max(500).default(""),
  })
  .refine(
    (v) => v.category !== "wash" || v.prices !== null,
    "Lavagem precisa ter preços",
  );
export const transactionSchema = z.strictObject({
  requestId: z.uuid().optional(),
  description: z.string().trim().min(2).max(200),
  category: z.string().trim().min(2).max(80),
  userId: objectId.optional(),
  amount,
  paymentMethod: z.enum(["pix", "cash", "card"]),
  date: z.iso.datetime({ offset: true }),
  notes: z.string().trim().max(1000).default(""),
});
export const settingsSchema = z
  .object({
    loyaltyTarget: z.literal(10),
    couponValidityDays: z.literal(30),
    couponSameVehicleType: z.literal(true),
    slotDuration: z.number().int().min(15).max(240),
    capacityPerSlot: z.number().int().min(1).max(30),
    openingDays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    openTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    closeTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    provisionalHours: z.boolean(),
  })
  .refine(
    (v) => v.openTime < v.closeTime,
    "O fechamento deve ser após a abertura",
  );
export const pointsSchema = z.strictObject({
  delta: z.number().int().min(-9).max(9),
  reason: z.string().trim().min(5).max(500),
});
export const clientSchema = z.strictObject({
  phone: phoneOrBlankSchema,
  vehicles: z.array(vehicleSchema).max(20),
});
export const slotSchema = z.object({
  scheduledAt: z.iso.datetime({ offset: true }),
  blocked: z.boolean(),
  capacity: z.number().int().min(1).max(30).optional(),
});
