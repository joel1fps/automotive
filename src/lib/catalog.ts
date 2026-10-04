export const TIME_ZONE = "America/Fortaleza";
export const LEGAL_NOTICE =
  "Não nos responsabilizamos por qualquer objeto de valor deixado dentro do veículo.";
export const vehicleLabels = {
  moto: "Moto",
  small: "Carro pequeno",
  suv: "SUV",
  pickup: "Caminhonete",
} as const;
export type VehicleType = keyof typeof vehicleLabels;
export const initialServices = [
  {
    name: "Lavagem Externa",
    slug: "externa",
    category: "wash",
    prices: { small: 30, suv: 40, pickup: 50 },
    countsForLoyalty: true,
    active: true,
    description: "Cuidado com a carroceria, rodas e acabamento exterior.",
  },
  {
    name: "Lavagem Simples",
    slug: "simples",
    category: "wash",
    prices: { small: 50, suv: 65, pickup: 80 },
    countsForLoyalty: true,
    active: true,
    description: "Limpeza por dentro e por fora para o cuidado do dia a dia.",
  },
  {
    name: "Lavagem Completa / Polimento",
    slug: "completa",
    category: "wash",
    prices: { small: 60, suv: 75, pickup: 90 },
    countsForLoyalty: true,
    active: true,
    description: "Uma atenção extra ao brilho e ao acabamento do seu carro.",
  },
  ...[
    "Higienização completa",
    "Higienização de motor",
    "Hidratação de bancos de couro",
    "Revitalização de farol",
    "Polimento técnico e comercial",
    "Vitrificação",
    "Película (linha Window Blue)",
    "PPF",
    "Dedetização automotiva",
  ].map((name, index) => ({
    name,
    slug: `extra-${index}`,
    category: "extra",
    prices: null,
    countsForLoyalty: false,
    active: true,
    description: "Avaliação do veículo e orçamento personalizado.",
  })),
  {
    name: "Oxi-sanitização com ozônio",
    slug: "oxi-sanitizacao",
    category: "extra",
    prices: null,
    countsForLoyalty: false,
    active: true,
    description:
      "R$ 150,00. Consulte a equipe sobre a aplicação e os cuidados do serviço.",
  },
  {
    name: "Lavagem de moto",
    slug: "moto",
    category: "extra",
    prices: null,
    countsForLoyalty: false,
    active: true,
    description: "A partir de R$ 25,00. Valor confirmado após avaliação.",
    vehicleTypes: ["moto"],
    startingPrice: 25,
  },
];
export const defaultSettings = {
  key: "main",
  loyaltyTarget: 10,
  couponValidityDays: 30,
  couponSameVehicleType: true,
  slotDuration: 60,
  capacityPerSlot: 1,
  openingDays: [1, 2, 3, 4, 5, 6],
  openTime: "08:00",
  closeTime: "17:00",
  provisionalHours: false,
};
export const money = (n: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    n,
  );
export const statusLabels: Record<string, string> = {
  pending: "Pendente",
  arrived: "No lava-jato",
  in_progress: "Em andamento",
  ready: "Pronto para retirada",
  delivered: "Entregue",
  confirmed: "Confirmado",
  completed: "Concluído",
  rejected: "Recusado",
  cancelled: "Cancelado",
  available: "Disponível",
  used: "Usado",
  expired: "Vencido",
};
