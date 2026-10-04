import { clerkClient } from "@clerk/nextjs/server";
import { randomUUID } from "node:crypto";
import { notificationText } from "@/lib/notifications";
import { NextRequest, NextResponse } from "next/server";
import { verifyWebhook } from "@clerk/nextjs/webhooks";
import { z, ZodError } from "zod";
import { requireActor, rateLimit } from "@/lib/auth";
import {
  Appointment,
  Audit,
  Coupon,
  Service,
  Slot,
  Transaction,
  User,
  connectDB,
} from "@/lib/db";
import {
  adjustPoints,
  availableSlots,
  changeAppointment,
  createBooking,
  getSettings,
  seedCatalog,
  updateSettings,
} from "@/lib/business";
import {
  AppError,
  assert,
  filterBounds,
  periodBounds,
  localDate,
} from "@/lib/domain";
import { financeQuery, financeSummary, financeWorkbook } from "@/lib/finance";
import { controlSummary } from "@/lib/control";
import {
  actionSchema,
  bookingSchema,
  clientSchema,
  dateSchema,
  manualBookingSchema,
  objectId,
  pointsSchema,
  serviceSchema,
  settingsSchema,
  slotSchema,
  transactionSchema,
} from "@/lib/validation";
import { initialServices } from "@/lib/catalog";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (value: unknown, status = 200) =>
  NextResponse.json(value, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
const body = async (req: NextRequest) => {
  assert(
    req.headers.get("content-type")?.includes("application/json"),
    "Envie JSON",
    415,
  );
  assert(
    Number(req.headers.get("content-length") || 0) < 300000,
    "Corpo muito grande",
    413,
  );
  const raw = await req.text();
  assert(Buffer.byteLength(raw, "utf8") < 300000, "Corpo muito grande", 413);
  try {
    return JSON.parse(raw);
  } catch {
    throw new AppError(400, "JSON inválido");
  }
};
const pageSchema = z.coerce.number().int().min(1).max(100000).default(1);
const escapeRegex = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
async function paged(
  model: typeof Appointment,
  query: Record<string, unknown>,
  page: number,
  sort: Record<string, 1 | -1> = { createdAt: -1 },
) {
  const [items, total] = await Promise.all([
    model
      .find(query)
      .sort(sort)
      .skip((page - 1) * 30)
      .limit(30)
      .lean(),
    model.countDocuments(query),
  ]);
  return { items, total, page, pages: Math.ceil(total / 30) };
}
async function handler(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
) {
  try {
    const { path } = await ctx.params;
    const route = path.join("/");
    const method = req.method;
    const q = req.nextUrl.searchParams;
    if (route === "webhooks/clerk" && method === "POST") {
      assert(process.env.CLERK_WEBHOOK_SECRET, "Webhook não configurado", 503);
      let event;
      try {
        event = await verifyWebhook(req, {
          signingSecret: process.env.CLERK_WEBHOOK_SECRET,
        });
      } catch {
        throw new AppError(400, "Assinatura de webhook inválida");
      }
      await connectDB();
      await rateLimit("webhook", 300);
      if (event.type === "user.created" || event.type === "user.updated") {
        const data = event.data;
        const email = data.email_addresses.find(
          (e) => e.id === data.primary_email_address_id,
        );
        const allow = (process.env.ADMIN_EMAILS || "")
          .split(",")
          .map((v) => v.trim().toLowerCase());
        const role =
          data.public_metadata.role === "admin" ||
          (email?.verification?.status === "verified" &&
            allow.includes(email.email_address.toLowerCase()))
            ? "admin"
            : "client";
        await User.updateOne(
          { clerkId: data.id },
          {
            $set: {
              name: [data.first_name, data.last_name].filter(Boolean).join(" "),
              email: email?.email_address,
              role,
            },
            $setOnInsert: { loyaltyCount: 0, totalWashes: 0 },
          },
          { upsert: true },
        );
      } else if (event.type === "user.deleted" && event.data.id)
        await User.updateOne(
          { clerkId: event.data.id },
          {
            $set: { name: "Conta removida", role: "client", vehicles: [] },
            $unset: { email: 1, phone: 1 },
          },
        );
      return json({ received: true });
    }
    if (method !== "GET") {
      const origin = req.headers.get("origin");
      if (origin)
        assert(origin === req.nextUrl.origin, "Origem não permitida", 403);
    }
    if (route === "services" && method === "GET") {
      if (!process.env.MONGODB_URI) return json(initialServices);
      await connectDB();
      await rateLimit(
        `public-services:${req.headers.get("x-vercel-forwarded-for") || "shared"}`,
        120,
      );
      await seedCatalog();
      const services = await Service.find({ active: true }).sort({ createdAt: 1 }).lean();
      // A new database has no catalog yet. Preserve the supplied public prices.
      // An intentionally disabled catalog must remain disabled.
      if (!services.length && !(await Service.exists({}))) return json(initialServices);
      return json(services);
    }
    const actor = await requireActor(route.startsWith("admin/"));
    await rateLimit(`actor:${actor.clerkId}`, method === "GET" ? 120 : 30);
    if (route === "slots" && method === "GET")
      return json(await availableSlots(dateSchema.parse(q.get("date"))));
    if (route === "appointments" && method === "POST")
      return json(
        await createBooking(bookingSchema.parse(await body(req)), actor),
        201,
      );
    if (route === "appointments/me" && method === "GET")
      return json(
        await paged(
          Appointment,
          { userId: actor.userId },
          pageSchema.parse(q.get("page") || undefined),
        ),
      );
    if (route === "loyalty/me" && method === "GET") {
      await Coupon.updateMany(
        {
          userId: actor.userId,
          status: "available",
          expiresAt: { $lt: new Date() },
          reservedAppointmentId: { $exists: false },
        },
        { $set: { status: "expired" } },
      );
      return json({
        loyaltyCount: actor.user.loyaltyCount,
        totalWashes: actor.user.totalWashes,
        vehicles: actor.user.vehicles,
        coupons: await Coupon.find({ userId: actor.userId })
          .sort({ issuedAt: -1 })
          .lean(),
      });
    }
    if (!route.startsWith("admin/"))
      throw new AppError(404, "Rota não encontrada");
    const resource = path[1];
    if (resource === "control" && path.length === 2 && method === "GET")
      return json(await controlSummary(dateSchema.parse(q.get("date"))));
    if(resource === "catalog-reset" && method === "POST") {
      await Service.db.transaction(async session => {
        for(const service of initialServices) await Service.updateOne({slug:service.slug},{$set:{...service,imageUrl:"",vehicleTypes: "vehicleTypes" in service ? service.vehicleTypes : []}},{upsert:true,session});
        await Audit.create([{adminClerkId:actor.clerkId,action:"catalog_reset",reason:"Restauração dos serviços originais; personalizados preservados"}],{session});
      });
      return json({restored:true});
    }
    const id =
      path[2] && ["appointments", "services", "clients"].includes(resource)
        ? objectId.parse(path[2])
        : undefined;
    if (resource === "appointments" && id && path[3] === "notify" && method === "POST") {
      const input = z.object({channel:z.enum(["email","whatsapp"])}).parse(await body(req));
      const appointment = await Appointment.findById(id);
      assert(appointment, "Agendamento não encontrado",404);
      const customer = await User.findById(appointment.userId);
      assert(customer, "Cadastre o cliente e seu contato antes de enviar",400);
      const message = notificationText(appointment);
      if(input.channel === "whatsapp") {
        const phone = String(customer.phone || "").replace(/\D/g,"");
        assert(phone.length >= 10 && phone.length <= 15,"Cadastre o WhatsApp do cliente com DDD na aba Clientes");
        return json({url: "https://wa.me/" + (phone.length <= 11 ? "55" : "") + phone + "?text=" + encodeURIComponent(message)});
      }
      assert(process.env.RESEND_API_KEY && process.env.EMAIL_FROM,"Configure RESEND_API_KEY e EMAIL_FROM para enviar e-mails",503);
      assert(customer.email,"Cliente sem e-mail");
      const response = await fetch("https://api.resend.com/emails", {method:"POST",headers:{Authorization:"Bearer " + process.env.RESEND_API_KEY,"Content-Type":"application/json","Idempotency-Key": "appointment-" + id + "-" + appointment.status},body:JSON.stringify({from:process.env.EMAIL_FROM,to:[customer.email],subject:"Automotive — atualização do seu serviço",text:message})});
      assert(response.ok,"O provedor não aceitou o envio. Confira a configuração de e-mail",502);
      await Audit.create({adminClerkId:actor.clerkId,action:"email_notification",reason: id + ":" + appointment.status});
      return json({sent:true});
    }
    if (resource === "appointments") {
      if (method === "GET" && !id) {
        const status = z
          .enum(["pending", "confirmed", "completed", "rejected", "cancelled", "arrived", "in_progress", "ready", "delivered", "active"])
          .optional()
          .parse(q.get("status") || undefined);
        const date = q.get("date")
          ? dateSchema.parse(q.get("date"))
          : undefined;
        const range = z
          .enum(["day", "week"])
          .default("day")
          .parse(q.get("range") || undefined);
        const bounds = date ? periodBounds(range, date) : undefined;
        return json(
          await paged(
            Appointment,
            {
              ...(status ? { status: status === "active" ? { $in: ["pending", "confirmed", "arrived", "in_progress", "ready", "completed", "delivered"] } : status } : {}),
              ...(bounds
                ? { scheduledAt: { $gte: bounds.from, $lt: bounds.to } }
                : {}),
            },
            pageSchema.parse(q.get("page") || undefined),
            { scheduledAt: 1 },
          ),
        );
      }
      if (method === "POST" && !id)
        return json(
          await createBooking(
            manualBookingSchema.parse(await body(req)),
            actor,
            true,
          ),
          201,
        );
      if (method === "PATCH" && id)
        return json(
          await changeAppointment(
            id,
            actionSchema.parse(await body(req)),
            actor.clerkId,
          ),
        );
    }
    if (resource === "services") {
      await seedCatalog();
      if (method === "POST" && id && path[3] === "reset") {
        const current = await Service.findById(id);
        const original = initialServices.find(s => s.slug === current?.slug);
        assert(original, "Somente serviços originais possuem padrão de restauração", 400);
        return json(await Service.findByIdAndUpdate(id, { $set: {...original, imageUrl: ""} }, {returnDocument:"after"}));
      }
      if (method === "GET")
        return json(await Service.find().sort({ createdAt: 1 }).lean());
      if (method === "POST" && !id)
        return json(
          await Service.create(serviceSchema.parse(await body(req))),
          201,
        );
      if (method === "PATCH" && id) {
        const input = serviceSchema.parse(await body(req));
        const existing = await Service.findById(id);
        assert(existing && existing.slug === input.slug, "O identificador não pode ser alterado", 400);
        const updated = await Service.findByIdAndUpdate(
          id,
          input,
          { returnDocument: "after", runValidators: true },
        );
        assert(updated, "Serviço não encontrado", 404);
        return json(updated);
      }
      if (method === "DELETE" && id) {
        const updated = await Service.findByIdAndUpdate(
          id,
          { $set: { active: false } },
          { returnDocument: "after" },
        );
        assert(updated, "Serviço não encontrado", 404);
        return json(updated);
      }
    }
    if (resource === "clients" && id && path[3] === "role" && method === "PATCH") {
      const input=z.object({role:z.enum(["admin","client"])}).parse(await body(req));
      const target=await User.findById(id);
      assert(target,"Cliente não encontrado",404);
      assert(target.clerkId !== actor.clerkId,"Você não pode alterar sua própria permissão");
      const allow=(process.env.ADMIN_EMAILS || "").split(",").map(v=>v.trim().toLowerCase());
      assert(!allow.includes(String(target.email).toLowerCase()),"Esta conta é administradora pelo ADMIN_EMAILS. Altere a variável para remover o acesso.");
      const clerk=await clerkClient();
      await clerk.users.updateUserMetadata(target.clerkId,{publicMetadata:{role:input.role}});
      target.role=input.role; await target.save();
      await Audit.create({adminClerkId:actor.clerkId,userId:target._id,action:"role_change",reason:input.role});
      return json({role:input.role});
    }
    if (resource === "clients") {
      if (method === "GET" && !id) {
        const search = z
          .string()
          .max(100)
          .parse(q.get("search") || "");
        return json(
          await paged(
            User,
            search
              ? {
                  $or: [
                    { name: { $regex: escapeRegex(search), $options: "i" } },
                    { email: { $regex: escapeRegex(search), $options: "i" } },
                  ],
                }
              : {},
            pageSchema.parse(q.get("page") || undefined),
          ),
        );
      }
      if (method === "GET" && id) {
        const client = await User.findById(id).lean();
        assert(client, "Cliente não encontrado", 404);
        return json({
          client,
          appointments: await Appointment.find({ userId: id })
            .sort({ scheduledAt: -1 })
            .limit(100)
            .lean(),
          audit: await Audit.find({ userId: id })
            .sort({ createdAt: -1 })
            .limit(100)
            .lean(),
        });
      }
      if (method === "PATCH" && id) {
        const input = await body(req);
        if (path[3] === "points") {
          const parsed = pointsSchema.parse(input);
          return json(
            await adjustPoints(id, parsed.delta, parsed.reason, actor.clerkId),
          );
        }
        const updated = await User.findByIdAndUpdate(
          id,
          { $set: clientSchema.parse(input) },
          { returnDocument: "after" },
        );
        assert(updated, "Cliente não encontrado", 404);
        return json(updated);
      }
    }
    if (resource === "coupons" && method === "POST") {
      const input=z.object({userId:objectId,vehicle:clientSchema.shape.vehicles.element,expiresAt:z.iso.datetime({offset:true}),reason:z.string().trim().min(5).max(500)}).parse(await body(req));
      assert(new Date(input.expiresAt)>new Date(),"Validade deve ser futura");
      assert(await User.exists({_id:input.userId}),"Cliente não encontrado",404);
      const coupon=await Coupon.create({userId:input.userId,vehiclePlate:input.vehicle.plate,vehicleType:input.vehicle.type,issuedAt:new Date(),expiresAt:new Date(input.expiresAt),issueKey:"manual:"+randomUUID()});
      await Audit.create({adminClerkId:actor.clerkId,userId:input.userId,action:"manual_coupon",reason:input.reason});
      return json(coupon,201);
    }
    if (resource === "coupons" && method === "GET") {
      await Coupon.updateMany(
        {
          status: "available",
          expiresAt: { $lt: new Date() },
          reservedAppointmentId: { $exists: false },
        },
        { $set: { status: "expired" } },
      );
      const status = z
        .enum(["available", "used", "expired"])
        .optional()
        .parse(q.get("status") || undefined);
      return json(
        await paged(
          Coupon,
          status ? { status } : {},
          pageSchema.parse(q.get("page") || undefined),
          { issuedAt: -1 },
        ),
      );
    }
    if (resource === "settings") {
      if (method === "GET") return json(await getSettings());
      if (method === "PATCH") {
        const data = settingsSchema.parse(await body(req));
        return json(await updateSettings(data));
      }
    }
    if (resource === "slots") {
      if (method === "GET") {
        const date = dateSchema.parse(q.get("date"));
        const settings = await getSettings();
        const { localSlots } = await import("@/lib/domain");
        const times = localSlots(date, settings);
        const slots = await Slot.find({
          key: { $in: times.map((t) => t.toISOString()) },
        }).lean();
        return json(
          times.map((t) => ({
            scheduledAt: t.toISOString(),
            used: 0,
            blocked: false,
            capacity: settings.capacityPerSlot,
            ...slots.find((s) => s.key === t.toISOString()),
          })),
        );
      }
      if (method === "PATCH") {
        const input = slotSchema.parse(await body(req));
        const key = new Date(input.scheduledAt).toISOString();
        await Slot.updateOne(
          { key },
          { $setOnInsert: { used: 0, blocked: false } },
          { upsert: true },
        );
        const updated = await Slot.findOneAndUpdate(
          {
            key,
            ...(input.capacity
              ? { $expr: { $lte: ["$used", input.capacity] } }
              : {}),
          },
          {
            $set: {
              blocked: input.blocked,
              ...(input.capacity ? { capacity: input.capacity } : {}),
            },
          },
          { returnDocument: "after" },
        );
        assert(updated, "Capacidade menor que as reservas existentes", 409);
        return json(updated);
      }
    }
    if (resource === "transactions" || resource === "finance") {
      if (resource === "transactions" && method === "POST") {
        const input = transactionSchema.parse(await body(req));
        assert(
          new Date(input.date) <= new Date(),
          "Lançamento não pode ter data futura",
        );
        const customer = input.userId
          ? await User.findById(input.userId)
          : null;
        assert(!input.userId || customer, "Cliente não encontrado", 404);
        return json(
          await Transaction.create({
            ...input,
            date: new Date(input.date),
            source: "manual",
            createdBy: actor.clerkId,
            clientName: customer?.name,
          }),
          201,
        );
      }
      if (method === "GET") {
        const range = z
          .enum(["day", "week", "month"])
          .default("month")
          .parse(q.get("range") || undefined);
        const date = dateSchema.parse(
          q.get("date") ||
            new Date().toLocaleDateString("en-CA", {
              timeZone: "America/Fortaleza",
            }),
        );
        const bounds =
          q.get("from") || q.get("to")
            ? filterBounds(
                dateSchema.parse(q.get("from")),
                dateSchema.parse(q.get("to")),
              )
            : periodBounds(range, date);
        assert(
          +bounds.to - +bounds.from <= 366 * 86400000,
          "Selecione até um ano por consulta",
        );
        const filter = {
          ...bounds,
          ...(!(q.get("from") || q.get("to"))
            ? {
                previous: periodBounds(
                  range,
                  localDate(new Date(+bounds.from - 1)),
                ),
              }
            : {}),
          category: z
            .string()
            .max(80)
            .optional()
            .parse(q.get("category") || undefined),
          paymentMethod: z
            .enum(["pix", "cash", "card"])
            .optional()
            .parse(q.get("paymentMethod") || undefined),
        };
        if (resource === "transactions")
          return json(
            await paged(
              Transaction,
              financeQuery(filter),
              pageSchema.parse(q.get("page") || undefined),
              { date: -1 },
            ),
          );
        if (path[2] === "summary") return json(await financeSummary(filter));
        if (path[2] === "export") {
          const buffer = await financeWorkbook(filter);
          return new NextResponse(new Uint8Array(buffer), {
            headers: {
              "Content-Type":
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
              "Content-Disposition":
                'attachment; filename="automotive-financeiro.xlsx"',
              "Cache-Control": "no-store",
            },
          });
        }
      }
    }
    throw new AppError(404, "Rota não encontrada");
  } catch (error) {
    if (error instanceof ZodError)
      return json(
        { error: error.issues.map((i) => i.message).join("; ") },
        400,
      );
    if (error instanceof AppError)
      return json({ error: error.message }, error.status);
    if (error instanceof Error && error.message === "DATABASE_NOT_CONFIGURED")
      return json(
        { error: "O sistema está aguardando conexão com o banco de dados." },
        503,
      );
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === 11000
    )
      return json(
        { error: "Registro duplicado. Atualize a página e tente novamente." },
        409,
      );
    console.error(
      "API failure",
      error instanceof Error ? error.name : "UnknownError",
    );
    return json(
      { error: "Não foi possível completar a operação. Tente novamente." },
      500,
    );
  }
}
export { handler as GET, handler as POST, handler as PATCH, handler as DELETE };
