import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

// ---------------------------------------------------------------------------
// Shared vocabularies
// ---------------------------------------------------------------------------

export const CLAIM_TYPES = [
  "documented",
  "marketing_claim",
  "official_public",
  "reported_public",
  "listed_price",
  "registered_transaction",
  "calculated",
  "estimated",
  "unverified",
  "unavailable",
] as const;
export type ClaimType = (typeof CLAIM_TYPES)[number];

export const VERIFICATION_STATUSES = ["unverified", "corroborated", "conflicting", "not_applicable"] as const;
export const CONFIDENCE = ["high", "medium", "low"] as const;

export const DOCUMENT_TYPES = ["merge1_brochure", "merge2_inventory", "dld_transactions_csv", "dld_projects_csv"] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const RUN_STATUSES = ["running", "completed", "completed_with_errors", "failed", "interrupted", "skipped"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

const SourceReferenceSchema = new Schema(
  {
    sourceType: { type: String, required: true },
    dataSourceKey: String,
    sourceDocumentId: { type: Schema.Types.ObjectId, ref: "SourceDocument" },
    page: Number,
    recordId: String,
    url: String,
    publishedAt: Date,
    retrievedAt: Date,
    snapshotDate: Date,
    claimType: { type: String, enum: CLAIM_TYPES, required: true },
    verificationStatus: { type: String, enum: VERIFICATION_STATUSES, default: "unverified" },
    limitations: String,
  },
  { _id: false },
);

function model<T extends Schema>(name: string, schema: T) {
  return (mongoose.models[name] as Model<InferSchemaType<T>>) ?? mongoose.model(name, schema);
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

const SourceDocumentSchema = new Schema(
  {
    filename: { type: String, required: true },
    sha256: { type: String, required: true, unique: true },
    documentType: { type: String, enum: DOCUMENT_TYPES, required: true },
    sizeBytes: { type: Number, required: true },
    pageCount: Number,
    importedAt: { type: Date, required: true },
    extractionVersion: String,
    extractionStatus: { type: String, enum: ["pending", "running", "completed", "completed_with_warnings", "failed"], default: "pending" },
    recordsExtracted: { type: Number, default: 0 },
    recordsAccepted: { type: Number, default: 0 },
    recordsRejected: { type: Number, default: 0 },
    metadata: { type: Schema.Types.Mixed, default: {} },
    warnings: { type: [String], default: [] },
  },
  { timestamps: true },
);
SourceDocumentSchema.index({ documentType: 1, importedAt: -1 });
SourceDocumentSchema.index({ filename: 1 });
export const SourceDocument = model("SourceDocument", SourceDocumentSchema);

const DataSourceSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    sourceType: { type: String, required: true },
    publisher: String,
    url: String,
    accessMethod: { type: String, required: true },
    refreshFrequency: String,
    lastAttemptAt: Date,
    lastSuccessfulFetchAt: Date,
    lastPublishedDate: Date,
    status: { type: String, enum: ["not_yet_imported", "ok", "error", "blocked", "manual_only"], default: "not_yet_imported" },
    usageNotes: String,
    errors: { type: [{ at: Date, message: String }], default: [] },
  },
  { timestamps: true, suppressReservedKeysWarning: true },
);
export const DataSource = model("DataSource", DataSourceSchema);

// ---------------------------------------------------------------------------
// Projects and project facts
// ---------------------------------------------------------------------------

export const GEO_PRECISIONS = ["verified", "approximate"] as const;

const ProjectSchema = new Schema(
  {
    name: { type: String, required: true },
    normalizedName: { type: String, required: true, unique: true },
    aliases: {
      type: [{ name: String, normalized: String, addedBy: { type: String, enum: ["import", "user"] }, addedAt: Date, note: String }],
      default: [],
    },
    /** normalizedName + every alias key; unique so one name can never resolve to two projects. */
    matchKeys: { type: [String], default: [] },
    location: String,
    projectType: String,
    description: String,
    positioning: String,
    amenities: { type: [String], default: [] },
    sourceReferences: { type: [SourceReferenceSchema], default: [] },
    /**
     * Map position recorded by a person with its source. Never geocoded automatically.
     * "verified" = position checked against an authoritative source (e.g. DLD/official map pin);
     * "approximate" = community or district level only.
     */
    geo: {
      type: new Schema(
        {
          lat: { type: Number, required: true },
          lng: { type: Number, required: true },
          precision: { type: String, enum: GEO_PRECISIONS, required: true },
          source: { type: String, required: true },
          sourceUrl: String,
          note: String,
          recordedAt: { type: Date, required: true },
        },
        { _id: false },
      ),
      default: undefined,
    },
    /** Every location decision (set, changed, cleared) with its evidence; never rewritten. */
    geoHistory: {
      type: [
        {
          action: { type: String, enum: ["set", "cleared"], required: true },
          lat: Number,
          lng: Number,
          precision: { type: String, enum: GEO_PRECISIONS },
          source: String,
          sourceUrl: String,
          note: String,
          at: { type: Date, required: true },
        },
      ],
      default: [],
    },
  },
  { timestamps: true },
);
ProjectSchema.index({ matchKeys: 1 }, { unique: true });
ProjectSchema.index({ name: 1 });
export const Project = model("Project", ProjectSchema);

export const FACT_CATEGORIES = ["location", "configuration", "amenity", "positioning", "payment_plan", "handover", "price_claim", "other"] as const;

const ProjectFactObservationSchema = new Schema(
  {
    projectId: { type: Schema.Types.ObjectId, ref: "Project", required: true },
    category: { type: String, enum: FACT_CATEGORIES, required: true },
    value: { type: String, required: true },
    extractedText: String,
    sourceDocumentId: { type: Schema.Types.ObjectId, ref: "SourceDocument" },
    sourcePage: Number,
    sourceUrl: String,
    observedAt: { type: Date, required: true },
    publishedAt: Date,
    claimType: { type: String, enum: CLAIM_TYPES, required: true },
    verificationStatus: { type: String, enum: VERIFICATION_STATUSES, default: "unverified" },
    confidence: { type: String, enum: CONFIDENCE, required: true },
    attributionMethod: String,
    notes: String,
  },
  { timestamps: true },
);
ProjectFactObservationSchema.index(
  { projectId: 1, sourceDocumentId: 1, sourcePage: 1, category: 1, value: 1 },
  { unique: true },
);
ProjectFactObservationSchema.index({ projectId: 1, category: 1 });
export const ProjectFactObservation = model("ProjectFactObservation", ProjectFactObservationSchema);

const BrochurePageSchema = new Schema(
  {
    sourceDocumentId: { type: Schema.Types.ObjectId, ref: "SourceDocument", required: true },
    page: { type: Number, required: true },
    text: { type: String, default: "" },
    charCount: { type: Number, required: true },
    hasTextLayer: { type: Boolean, required: true },
    detectedProjectIds: { type: [Schema.Types.ObjectId], ref: "Project", default: [] },
    detectedNames: { type: [String], default: [] },
    attribution: { type: String, enum: ["single_name_match", "carried_forward", "ambiguous", "none"], required: true },
  },
  { timestamps: true },
);
BrochurePageSchema.index({ sourceDocumentId: 1, page: 1 }, { unique: true });
BrochurePageSchema.index({ detectedProjectIds: 1 });
BrochurePageSchema.index({ text: "text" });
export const BrochurePage = model("BrochurePage", BrochurePageSchema);

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

const InventorySnapshotSchema = new Schema(
  {
    sourceDocumentId: { type: Schema.Types.ObjectId, ref: "SourceDocument", required: true },
    extractionVersion: { type: String, required: true },
    snapshotDate: Date,
    snapshotDateStatus: { type: String, enum: ["from_document", "unknown", "ambiguous"], required: true },
    snapshotDateEvidence: { page: Number, text: String },
    importedAt: { type: Date, required: true },
    recordCount: { type: Number, default: 0 },
    rejectedCount: { type: Number, default: 0 },
    /** True when a newer extraction version of the same document exists; kept for history, excluded from metrics. */
    superseded: { type: Boolean, default: false },
    warnings: { type: [String], default: [] },
  },
  { timestamps: true },
);
InventorySnapshotSchema.index({ sourceDocumentId: 1, extractionVersion: 1 }, { unique: true });
InventorySnapshotSchema.index({ superseded: 1, snapshotDate: -1 });
export const InventorySnapshot = model("InventorySnapshot", InventorySnapshotSchema);

const InventoryUnitObservationSchema = new Schema(
  {
    projectId: { type: Schema.Types.ObjectId, ref: "Project" },
    projectNameAsListed: String,
    sourceDocumentId: { type: Schema.Types.ObjectId, ref: "SourceDocument", required: true },
    snapshotId: { type: Schema.Types.ObjectId, ref: "InventorySnapshot", required: true },
    sourcePage: { type: Number, required: true },
    lineIndex: { type: Number, required: true },
    serialNumber: String,
    unitNumber: String,
    unitKey: String,
    unitType: String,
    typology: String,
    areaSqFt: Number,
    view: String,
    listedPriceAED: Number,
    status: String,
    statusNormalized: String,
    pricePerSqFt: Number,
    originalValues: { type: Schema.Types.Mixed, required: true },
    validationWarnings: { type: [String], default: [] },
  },
  { timestamps: true },
);
InventoryUnitObservationSchema.index({ snapshotId: 1, sourcePage: 1, lineIndex: 1 }, { unique: true });
InventoryUnitObservationSchema.index({ snapshotId: 1, projectId: 1 });
InventoryUnitObservationSchema.index({ projectId: 1, unitKey: 1 });
InventoryUnitObservationSchema.index({ unitNumber: 1 });
export const InventoryUnitObservation = model("InventoryUnitObservation", InventoryUnitObservationSchema);

// ---------------------------------------------------------------------------
// Rejected records: nothing that fails extraction or validation is dropped silently.
// ---------------------------------------------------------------------------

const RejectedRecordSchema = new Schema(
  {
    documentType: { type: String, enum: DOCUMENT_TYPES, required: true },
    sourceDocumentId: { type: Schema.Types.ObjectId, ref: "SourceDocument", required: true },
    extractionVersion: { type: String, required: true },
    ingestionRunId: { type: Schema.Types.ObjectId, ref: "IngestionRun" },
    locator: { type: String, required: true },
    raw: { type: Schema.Types.Mixed },
    reasons: { type: [String], required: true },
  },
  { timestamps: true },
);
RejectedRecordSchema.index({ sourceDocumentId: 1, extractionVersion: 1, locator: 1 }, { unique: true });
export const RejectedRecord = model("RejectedRecord", RejectedRecordSchema);

// ---------------------------------------------------------------------------
// Market data (DLD exports)
// ---------------------------------------------------------------------------

const MarketTransactionSchema = new Schema(
  {
    externalTransactionId: { type: String, required: true, unique: true },
    transactionDate: { type: Date, required: true },
    transactionType: String,
    transactionSubType: String,
    registrationType: String,
    isFreeHold: String,
    usage: String,
    community: String,
    propertyType: String,
    propertySubType: String,
    rooms: String,
    transactionValueAED: { type: Number, required: true },
    transactionSizeSqm: Number,
    propertySizeSqm: Number,
    areaSqFt: Number,
    masterProject: String,
    projectNameAsReported: String,
    projectNormalizedName: String,
    /** Link to a Project only through an exact name/alias match. */
    projectId: { type: Schema.Types.ObjectId, ref: "Project" },
    matchMethod: { type: String, enum: ["exact_alias", "none"], default: "none" },
    matchConfidence: { type: String, enum: ["high", "none"], default: "none" },
    /** Developer from the DLD project register, matched by exact normalized project name. */
    developerName: String,
    developerNumber: String,
    developerMatchMethod: { type: String, enum: ["dld_project_register_exact", "none"], default: "none" },
    sourceKey: { type: String, required: true },
    sourceDocumentId: { type: Schema.Types.ObjectId, ref: "SourceDocument", required: true },
    rowHash: { type: String, required: true },
    originalValues: { type: Schema.Types.Mixed, required: true },
  },
  { timestamps: true },
);
MarketTransactionSchema.index({ transactionDate: 1 });
MarketTransactionSchema.index({ projectId: 1, transactionDate: 1 });
MarketTransactionSchema.index({ projectNormalizedName: 1 });
MarketTransactionSchema.index({ developerName: 1, transactionDate: 1 });
MarketTransactionSchema.index({ community: 1, transactionDate: 1 });
export const MarketTransaction = model("MarketTransaction", MarketTransactionSchema);

const DldProjectObservationSchema = new Schema(
  {
    projectNumber: { type: String, required: true },
    projectName: { type: String, required: true },
    normalizedName: { type: String, required: true },
    developerNumber: String,
    developerName: String,
    projectStatus: String,
    completedPct: Number,
    startDate: Date,
    endDate: Date,
    completionDate: Date,
    area: String,
    masterProject: String,
    totalUnits: Number,
    sourceDocumentId: { type: Schema.Types.ObjectId, ref: "SourceDocument", required: true },
    retrievedAt: { type: Date, required: true },
    rowHash: { type: String, required: true },
    originalValues: { type: Schema.Types.Mixed, required: true },
  },
  { timestamps: true },
);
// Same project + identical content = same observation; changed content = new observation (history kept).
DldProjectObservationSchema.index({ projectNumber: 1, rowHash: 1 }, { unique: true });
DldProjectObservationSchema.index({ normalizedName: 1, retrievedAt: -1 });
DldProjectObservationSchema.index({ developerName: 1 });
export const DldProjectObservation = model("DldProjectObservation", DldProjectObservationSchema);

// ---------------------------------------------------------------------------
// Public events (entered by a person from a public source; never scraped)
// ---------------------------------------------------------------------------

export const EVENT_TYPES = ["launch", "payment_plan", "handover", "construction_update", "sales_announcement", "corporate", "sponsorship", "market_report", "other"] as const;

const PublicEventSchema = new Schema(
  {
    title: { type: String, required: true },
    titleNormalized: { type: String, required: true },
    eventType: { type: String, enum: EVENT_TYPES, required: true },
    eventDate: Date,
    publicationDate: Date,
    publisher: { type: String, required: true },
    url: { type: String, required: true },
    summary: { type: String, required: true },
    projectIds: { type: [Schema.Types.ObjectId], ref: "Project", default: [] },
    claimType: { type: String, enum: CLAIM_TYPES, required: true },
    retrievedAt: { type: Date, required: true },
    sourceReferences: { type: [SourceReferenceSchema], default: [] },
    retractedAt: Date,
    retractionReason: String,
  },
  { timestamps: true },
);
PublicEventSchema.index({ url: 1, titleNormalized: 1 }, { unique: true });
PublicEventSchema.index({ publicationDate: -1 });
PublicEventSchema.index({ projectIds: 1 });
export const PublicEvent = model("PublicEvent", PublicEventSchema);

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

const IngestionRunSchema = new Schema(
  {
    sourceKey: { type: String, required: true },
    sourceDocumentId: { type: Schema.Types.ObjectId, ref: "SourceDocument" },
    filename: String,
    trigger: { type: String, enum: ["cli", "ui", "test"], required: true },
    startedAt: { type: Date, required: true },
    heartbeatAt: Date,
    completedAt: Date,
    status: { type: String, enum: RUN_STATUSES, required: true },
    recordsDiscovered: { type: Number, default: 0 },
    recordsCreated: { type: Number, default: 0 },
    recordsUpdated: { type: Number, default: 0 },
    recordsSkipped: { type: Number, default: 0 },
    recordsRejected: { type: Number, default: 0 },
    errors: { type: [String], default: [] },
    warnings: { type: [String], default: [] },
  },
  { timestamps: true, suppressReservedKeysWarning: true },
);
IngestionRunSchema.index({ sourceKey: 1, startedAt: -1 });
IngestionRunSchema.index({ status: 1 });
export const IngestionRun = model("IngestionRun", IngestionRunSchema);

export const ISSUE_SEVERITIES = ["info", "warning", "error"] as const;

const DataQualityIssueSchema = new Schema(
  {
    /** Deterministic key so re-running checks updates lastSeenAt instead of duplicating issues. */
    key: { type: String, required: true, unique: true },
    entityType: { type: String, required: true },
    entityId: String,
    rule: { type: String, required: true },
    severity: { type: String, enum: ISSUE_SEVERITIES, required: true },
    details: { type: String, required: true },
    sourceReferences: { type: [SourceReferenceSchema], default: [] },
    detectedAt: { type: Date, required: true },
    lastSeenAt: { type: Date, required: true },
    resolvedAt: Date,
    resolutionNote: String,
  },
  { timestamps: true },
);
DataQualityIssueSchema.index({ rule: 1, resolvedAt: 1 });
DataQualityIssueSchema.index({ severity: 1, resolvedAt: 1 });
export const DataQualityIssue = model("DataQualityIssue", DataQualityIssueSchema);

export const ALL_MODELS = [
  SourceDocument,
  DataSource,
  Project,
  ProjectFactObservation,
  BrochurePage,
  InventorySnapshot,
  InventoryUnitObservation,
  RejectedRecord,
  MarketTransaction,
  DldProjectObservation,
  PublicEvent,
  IngestionRun,
  DataQualityIssue,
];

export async function ensureIndexes() {
  for (const m of ALL_MODELS) await m.syncIndexes();
}
