import { clerkClient } from "@clerk/nextjs/server";
import { notificationText } from "@/lib/notifications";
import { NextRequest, NextResponse } from "next/server";
import { verifyWebhook } from "@clerk/nextjs/webhooks";
import { z, ZodError } from "zod";
import { requireActor, rateLimit, readOwnProfile, updateOwnProfile } from "@/lib/auth";
import { clerkProfileName, phoneSchema } from "@/lib/profile";
import { syncClerkIdentity } from "@/lib/profile-store";
import { serverRole } from "@/lib/access-policy";
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
  deleteAppointment,
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
import { completeWorkbook, financeQuery, financeSummary, financeWorkbook, servicesReport, servicesWorkbook } from "@/lib/finance";
import { correctTransaction, createManualTransaction, issueManualCoupon, transactionNets } from "@/lib/financial-operations";
import { historyCriteria } from "@/lib/history-criteria";
import { controlSummary, operationalQueue, queueFiltersSchema } from "@/lib/control";
import { ACTIVE_APPOINTMENT_STATUSES } from "@/lib/appointment-state";
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
} from "@/lib/validation";
import { initialServices } from "@/lib/catalog";
import { assertMutationOrigin, publicRateKey, readBoundedText, readJsonBody } from "@/lib/request-security";
import { generateTracking, readAdminTracking, readPublicTracking, revokeTracking, trackingActionSchema, updateTrackingEstimate, validTrackingToken } from "@/lib/tracking";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (value: unknown, status = 200) =>
  NextResponse.json(value, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
const body = readJsonBody;
const pageSchema = z.coerce.number().int().min(1).max(100000).default(1);
const escapeRegex = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
async function paged(
  model: typeof Appointment,
  query: Record<string, unknown>,
  page: number,
  sort: Record<string, 1 | -1> = { createdAt: -1 },
  customer = false,
) {
  const find = model.find(query).sort(sort).skip((page - 1) * 30).limit(30);
  if (customer) find.populate("userId", "name email phone");
  const [items, total] = await Promise.all([
    find.lean(),
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
    if (path[0] === "tracking") {
      const trackingJson = (value: unknown, status = 200) => NextResponse.json(value, {
        status,
        headers: {
          "Cache-Control": "no-store, private",
          "X-Robots-Tag": "noindex, nofollow, noarchive",
          "Referrer-Policy": "no-referrer",
          ...(status === 405 ? { Allow: "GET" } : {}),
        },
      });
      // All public tracking routes are read-only, even for an authenticated administrator.
      if (method !== "GET") return trackingJson({ error: "O acompanhamento é somente de leitura." }, 405);
      if (path.length !== 2 || !validTrackingToken(path[1])) return trackingJson({ error: "Link de acompanhamento indisponível." }, 404);
      try {
        await rateLimit(publicRateKey(req, "public-tracking"), 120);
        return trackingJson(await readPublicTracking(path[1]));
      } catch (error) {
        if (error instanceof AppError) return trackingJson({ error: error.message }, error.status);
        return trackingJson({ error: "Não foi possível consultar o acompanhamento. Tente novamente em instantes." }, 503);
      }
    }
    if (route === "webhooks/clerk" && method === "POST") {
      assert(process.env.CLERK_WEBHOOK_SECRET, "Webhook não configurado", 503);
      let event;
      try {
        const raw = await readBoundedText(req);
        event = await verifyWebhook(new NextRequest(req.url, { method: "POST", headers: req.headers, body: raw }), {
          signingSecret: process.env.CLERK_WEBHOOK_SECRET,
        });
      } catch (error) {
        if (error instanceof AppError) throw error;
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
        await syncClerkIdentity({
          clerkId: data.id,
          name: clerkProfileName(data.first_name, data.last_name),
          email: email?.email_address,
          role: serverRole(data.public_metadata, email?.email_address,
            email?.verification?.status === "verified", allow),
        });
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
    assertMutationOrigin(req);
    if (route === "services" && method === "GET") {
      if (!process.env.MONGODB_URI) return json(initialServices);
      await connectDB();
      await rateLimit(
        publicRateKey(req, "public-services"),
        120,
      );
      await seedCatalog();
      const services = await Service.find({ active: true }).sort({ createdAt: 1 }).lean();
      // A new database has no catalog yet. Preserve the supplied public prices.
      // An intentionally disabled catalog must remain disabled.
      if (!services.length && !(await Service.exists({}))) return json(initialServices);
      return json(services);
    }
    const actor = await requireActor(route.startsWith("admin/"), { apiMethod: method });
    if (route === "profile/me") {
      if (method === "GET") return json(await readOwnProfile(actor));
      if (method === "PATCH") return json(await updateOwnProfile(actor, await body(req)));
    }
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
          { userId: actor.userId, deletedAt: { $exists: false } },
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
    if (["queue", "control"].includes(resource) && path.length === 2 && method === "GET") {
      const filters = queueFiltersSchema.parse({ search: q.get("search") || undefined, status: q.get("status") || undefined });
      const hasPeriod = ["date", "range", "from", "to"].some((key) => q.has(key));
      if (resource === "queue" && !hasPeriod) return json(await operationalQueue(undefined, filters));
      const date = dateSchema.parse(q.get("date") || localDate(new Date()));
      const range = z.enum(["day", "week", "month"]).default("day").parse(q.get("range") || undefined);
      const bounds = q.get("from") || q.get("to")
        ? filterBounds(dateSchema.parse(q.get("from")), dateSchema.parse(q.get("to")))
        : periodBounds(range, date);
      assert(+bounds.to - +bounds.from <= 366 * 86400000, "Selecione até um ano por consulta");
      const criterion = z.enum(historyCriteria).default("scheduled").parse(q.get("criterion") || undefined);
      return resource === "queue"
        ? json(await operationalQueue({ ...bounds, page: pageSchema.parse(q.get("page") || undefined), criterion, ...filters }))
        : json(await controlSummary(date, range, bounds, criterion, filters));
    }
    if (resource === "audit" && path.length === 2 && method === "GET") {
      const page = pageSchema.parse(q.get("page") || undefined);
      const action = z.string().max(80).regex(/^[a-z_]+$/).optional().parse(q.get("action") || undefined);
      const appointmentId = q.get("appointmentId") ? objectId.parse(q.get("appointmentId")) : undefined;
      const bounds = q.get("from") || q.get("to")
        ? filterBounds(dateSchema.parse(q.get("from")), dateSchema.parse(q.get("to"))) : undefined;
      if (bounds) assert(+bounds.to - +bounds.from <= 366 * 86400000, "Selecione até um ano por consulta");
      const query = {
        ...(action ? { action } : {}), ...(appointmentId ? { appointmentId } : {}),
        ...(bounds ? { createdAt: { $gte: bounds.from, $lt: bounds.to } } : {}),
      };
      const [entries, total] = await Promise.all([
        Audit.find(query).select("action reason createdAt adminClerkId userId appointmentId transactionId fromStatus toStatus before after estimatedCompletionBefore estimatedCompletionAfter details")
          .sort({ createdAt: -1, _id: -1 }).skip((page - 1) * 30).limit(30).lean(),
        Audit.countDocuments(query),
      ]);
      const clerkIds = [...new Set(entries.flatMap((entry) => entry.adminClerkId ? [entry.adminClerkId] : []))];
      const userIds = [...new Set(entries.flatMap((entry) => entry.userId ? [String(entry.userId)] : []))];
      const people = clerkIds.length || userIds.length
        ? await User.find({ $or: [{ clerkId: { $in: clerkIds } }, { _id: { $in: userIds } }] }).select("clerkId name").lean() : [];
      const admins = new Map(people.map((person) => [person.clerkId, person.name]));
      const clients = new Map(people.map((person) => [String(person._id), person.name]));
      const items = entries.map((entry) => {
        const details = entry.details || {};
        const clientName = details.clientName || (entry.userId ? clients.get(String(entry.userId)) : undefined);
        return {
          _id: String(entry._id), action: entry.action, reason: entry.reason, createdAt: entry.createdAt,
          adminClerkId: entry.adminClerkId,
          actorName: entry.adminClerkId ? admins.get(entry.adminClerkId) || "Administrador" : clientName || "Cliente",
          appointmentId: entry.appointmentId ? String(entry.appointmentId) : undefined,
          transactionId: entry.transactionId ? String(entry.transactionId) : undefined,
          clientName, fromStatus: entry.fromStatus, toStatus: entry.toStatus, before: entry.before, after: entry.after,
          estimatedCompletionBefore: entry.estimatedCompletionBefore, estimatedCompletionAfter: entry.estimatedCompletionAfter,
          details: {
            clientName: details.clientName, serviceName: details.serviceName,
            ...(details.vehicle ? { vehicle: { model: details.vehicle.model, plate: details.vehicle.plate } } : {}),
            scheduledAt: details.scheduledAt, quotedPrice: details.quotedPrice, finalPrice: details.finalPrice,
          },
        };
      });
      return json({ items, total, page, pages: Math.ceil(total / 30) });
    }
    if(resource === "catalog-reset" && method === "POST") {
      await Service.db.transaction(async session => {
        for(const service of initialServices) await Service.updateOne({slug:service.slug},{$set:{...service,imageUrl:"",vehicleTypes: "vehicleTypes" in service ? service.vehicleTypes : []}},{upsert:true,session});
        await Audit.create([{adminClerkId:actor.clerkId,action:"catalog_reset",reason:"Restauração dos serviços originais; personalizados preservados"}],{session});
      });
      return json({restored:true});
    }
    const id =
      path[2] && path[2] !== "calendar" && ["appointments", "services", "clients", "transactions"].includes(resource)
        ? objectId.parse(path[2])
        : undefined;
    if (resource === "appointments" && id && path[3] === "tracking" && path.length === 4) {
      if (method === "GET") return json(await readAdminTracking(id));
      if (method === "POST") {
        const input = trackingActionSchema.parse(await body(req));
        return json(await generateTracking(id, input.action, actor.clerkId));
      }
      if (method === "DELETE") return json(await revokeTracking(id, actor.clerkId));
      if (method === "PATCH") return json(await updateTrackingEstimate(id, await body(req), actor.clerkId));
    }
    if (resource === "appointments" && id && path[3] === "notify" && method === "POST") {
      const input = z.strictObject({channel:z.enum(["email","whatsapp"])}).parse(await body(req));
      const appointment = await Appointment.findOne({ _id: id, deletedAt: { $exists: false } });
      assert(appointment, "Agendamento não encontrado",404);
      const customer = appointment.userId ? await User.findById(appointment.userId) : null;
      const message = notificationText(appointment);
      if(input.channel === "whatsapp") {
        const parsedPhone = phoneSchema.safeParse(customer?.phone || appointment.guestPhone || "");
        assert(parsedPhone.success, "Cadastre um WhatsApp válido com DDD no perfil do cliente ou atendimento avulso");
        return json({url: "https://wa.me/" + parsedPhone.data + "?text=" + encodeURIComponent(message)});
      }
      assert(process.env.RESEND_API_KEY && process.env.EMAIL_FROM,"Configure RESEND_API_KEY e EMAIL_FROM para enviar e-mails",503);
      assert(customer?.email,"Cliente sem e-mail cadastrado");
      const response = await fetch("https://api.resend.com/emails", {method:"POST",headers:{Authorization:"Bearer " + process.env.RESEND_API_KEY,"Content-Type":"application/json","Idempotency-Key": "appointment-" + id + "-" + appointment.status},body:JSON.stringify({from:process.env.EMAIL_FROM,to:[customer.email],subject:"Automotive — atualização do seu serviço",text:message})});
      assert(response.ok,"O provedor não aceitou o envio. Confira a configuração de e-mail",502);
      await Audit.create({adminClerkId:actor.clerkId,action:"email_notification",reason: id + ":" + appointment.status});
      return json({sent:true});
    }
    if (resource === "appointments" && path[2] === "calendar" && path.length === 3 && method === "GET") {
      const date = dateSchema.parse(q.get("date") || localDate(new Date()));
      const range = z.enum(["day", "week", "month"]).default("month").parse(q.get("range") || undefined);
      const status = z.enum(["pending", "confirmed", "arrived", "in_progress", "ready", "completed", "delivered", "cancelled", "rejected", "returned"]).optional().parse(q.get("status") || undefined);
      const bounds = periodBounds(range, date);
      const days = await Appointment.aggregate([
        { $match: { deletedAt: { $exists: false }, scheduledAt: { $gte: bounds.from, $lt: bounds.to }, ...(status ? { status } : {}) } },
        { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$scheduledAt", timezone: "America/Fortaleza" } }, total: { $sum: 1 } } },
        { $sort: { _id: 1 } }, { $project: { _id: 0, date: "$_id", total: 1 } },
      ]);
      return json({ days, total: days.reduce((sum, day) => sum + day.total, 0) });
    }
    if (resource === "appointments") {
      if (method === "GET" && !id) {
        const status = z
          .enum(["pending", "confirmed", "completed", "rejected", "cancelled", "arrived", "in_progress", "ready", "delivered", "returned", "active"])
          .optional()
          .parse(q.get("status") || undefined);
        const date = q.get("date")
          ? dateSchema.parse(q.get("date"))
          : undefined;
        const range = z
          .enum(["day", "week", "month"])
          .default("day")
          .parse(q.get("range") || undefined);
        const bounds = date ? periodBounds(range, date) : undefined;
        return json(
          await paged(
            Appointment,
            {
              deletedAt: { $exists: false },
              ...(status ? { status: status === "active" ? { $in: ACTIVE_APPOINTMENT_STATUSES } : status } : {}),
              ...(bounds
                ? { scheduledAt: { $gte: bounds.from, $lt: bounds.to } }
                : {}),
            },
            pageSchema.parse(q.get("page") || undefined),
            { scheduledAt: 1 },
            true,
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
      if (method === "DELETE" && id && path.length === 3)
        return json(await deleteAppointment(id, await body(req), actor.clerkId));
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
      const input=z.strictObject({role:z.enum(["admin","client"])}).parse(await body(req));
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
          appointments: await Appointment.find({ userId: id, deletedAt: { $exists: false } })
            .sort({ scheduledAt: -1 })
            .limit(100)
            .lean(),
          audit: await Audit.find({ userId: id, action: "loyalty_adjustment" })
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
      return json(await issueManualCoupon(await body(req), actor.clerkId), 201);
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
        .enum(["available", "used", "expired", "revoked"])
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
    if (resource === "transactions" && id && path[3] === "correction" && path.length === 4 && method === "POST")
      return json(await correctTransaction(id, await body(req), actor.clerkId), 201);
    if (resource === "transactions" || resource === "finance" || resource === "service-report") {
      if (resource === "transactions" && method === "POST") {
        return json(await createManualTransaction(await body(req), actor.clerkId), 201);
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
        if (resource === "transactions") {
          const result = await paged(
              Transaction,
              financeQuery(filter),
              pageSchema.parse(q.get("page") || undefined),
              { date: -1 },
            );
          return json({ ...result, items: await transactionNets(result.items) });
        }
        const serviceFilter = { ...bounds, category: filter.category, criterion: z.enum(["ready", "delivered"]).default("ready").parse(resource === "service-report" || q.get("report") === "services" ? q.get("criterion") || undefined : undefined) };
        if (resource === "service-report" && path.length === 2) return json(await servicesReport(serviceFilter, pageSchema.parse(q.get("page") || undefined)));
        if (path[2] === "summary") return json(await financeSummary(filter));
        if (path[2] === "export") {
          const report = z.enum(["receipts", "services", "complete"]).default("receipts").parse(q.get("report") || undefined);
          z.literal("xlsx").default("xlsx").parse(q.get("format") || undefined);
          const vehicleCriterion = z.enum(historyCriteria).default("scheduled").parse(report === "complete" ? q.get("criterion") || undefined : undefined);
          await rateLimit(`finance-export:${actor.clerkId}`, 5);
          const buffer = report === "complete" ? await completeWorkbook(filter, vehicleCriterion)
            : report === "services" ? await servicesWorkbook(serviceFilter) : await financeWorkbook(filter);
          const filename = `automotive-${{ receipts: "faturamento", services: "servicos", complete: "completo" }[report]}-${localDate(bounds.from)}-a-${localDate(new Date(+bounds.to - 1))}.xlsx`;
          return new NextResponse(new Uint8Array(buffer), {
            headers: {
              "Content-Type":
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
              "Content-Disposition": `attachment; filename="${filename}"`,
              "Cache-Control": "no-store",
              "X-Content-Type-Options": "nosniff",
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
