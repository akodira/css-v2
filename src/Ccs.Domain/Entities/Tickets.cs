namespace Ccs.Domain.Entities;

public class Ticket
{
    public Guid Id { get; set; }
    public long Seq { get; set; }
    public string Reference { get; set; } = "";
    public Guid RequesterId { get; set; }
    public string Subject { get; set; } = "";
    public string Description { get; set; } = "";
    public Guid? TicketTypeId { get; set; }
    public Guid CategoryId { get; set; }
    public Guid? SubcategoryId { get; set; }
    public string Priority { get; set; } = "normal";
    public string Status { get; set; } = TicketStatus.New;
    public Guid? TeamId { get; set; }
    public Guid? AssignedAgentId { get; set; }
    public string? ResolutionSummary { get; set; }
    public DateTimeOffset? ResolvedAt { get; set; }
    public Guid? ResolvedBy { get; set; }
    public DateTimeOffset? ClosedAt { get; set; }
    public Guid? ClosedBy { get; set; }
    public string? ClosureReason { get; set; }
    public int ReopenedCount { get; set; }
    public Guid? CreatedBy { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    public byte[] RowVersion { get; set; } = [];
}

public class TicketCounter
{
    public int Year { get; set; }
    public int LastValue { get; set; }
}

public class TicketMessage
{
    public Guid Id { get; set; }
    public Guid TicketId { get; set; }
    public Guid? AuthorId { get; set; }
    public string Kind { get; set; } = MessageKind.PublicReply;
    public string Body { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? EditedAt { get; set; }
    public DateTimeOffset? DeletedAt { get; set; }
}

public class TicketAttachment
{
    public Guid Id { get; set; }
    public Guid TicketId { get; set; }
    public Guid? MessageId { get; set; }
    public string StoragePath { get; set; } = "";
    public string FileName { get; set; } = "";
    public string MimeType { get; set; } = "";
    public long SizeBytes { get; set; }
    public Guid UploadedBy { get; set; }
    public string ScanStatus { get; set; } = "pending";
    public DateTimeOffset CreatedAt { get; set; }
}

public class TicketStatusHistory
{
    public Guid Id { get; set; }
    public Guid TicketId { get; set; }
    public string? FromStatus { get; set; }
    public string ToStatus { get; set; } = "";
    public Guid? ChangedBy { get; set; }
    public string? Reason { get; set; }
    public string? ClosureReason { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

public class TicketStatusTransition
{
    public string FromStatus { get; set; } = "";
    public string ToStatus { get; set; } = "";
    public string Actor { get; set; } = "";
    public bool RequiresReason { get; set; }
}

public class TicketAssignment
{
    public Guid Id { get; set; }
    public Guid TicketId { get; set; }
    public Guid? FromAgent { get; set; }
    public Guid? ToAgent { get; set; }
    public Guid? FromTeam { get; set; }
    public Guid? ToTeam { get; set; }
    public Guid AssignedBy { get; set; }
    public string? Reason { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

public class TicketLink
{
    public Guid Id { get; set; }
    public Guid TicketId { get; set; }
    public Guid LinkedTicketId { get; set; }
    public string Kind { get; set; } = "";
    public Guid? CreatedBy { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

public class TicketCancellationRequest
{
    public Guid Id { get; set; }
    public Guid TicketId { get; set; }
    public Guid RequestedBy { get; set; }
    public string Reason { get; set; } = "";
    public string Status { get; set; } = "pending";
    public Guid? DecidedBy { get; set; }
    public DateTimeOffset? DecidedAt { get; set; }
    public string? DecisionNote { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

public class CustomerFeedback
{
    public Guid TicketId { get; set; }
    public short Rating { get; set; }
    public string? Comment { get; set; }
    public Guid SubmittedBy { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

public class TicketCustomFieldValue
{
    public Guid TicketId { get; set; }
    public Guid FieldId { get; set; }
    public string Value { get; set; } = "null";   // JSON
}

public class TicketSlaRecord
{
    public Guid TicketId { get; set; }
    public Guid? PolicyId { get; set; }
    public DateTimeOffset? FirstResponseDue { get; set; }
    public DateTimeOffset? ResolutionDue { get; set; }
    public DateTimeOffset? FirstRespondedAt { get; set; }
    public DateTimeOffset? ResolvedAt { get; set; }
    public DateTimeOffset? PausedAt { get; set; }
    public int PausedTotalSeconds { get; set; }
    public string State { get; set; } = SlaState.OnTrack;
    public DateTimeOffset? WarningSentAt { get; set; }
    public DateTimeOffset? BreachedAt { get; set; }
    public DateTimeOffset? BreachNotifiedAt { get; set; }
    public int CycleNo { get; set; } = 1;
    public DateTimeOffset CycleStartedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

public class TicketSlaCycle
{
    public Guid Id { get; set; }
    public Guid TicketId { get; set; }
    public int CycleNo { get; set; }
    public string Kind { get; set; } = "initial";
    public DateTimeOffset StartedAt { get; set; }
    public DateTimeOffset EndedAt { get; set; }
    public Guid? PolicyId { get; set; }
    public DateTimeOffset? FirstResponseDue { get; set; }
    public DateTimeOffset? ResolutionDue { get; set; }
    public DateTimeOffset? FirstRespondedAt { get; set; }
    public DateTimeOffset? ResolvedAt { get; set; }
    public DateTimeOffset? BreachedAt { get; set; }
    public string? State { get; set; }
    public int PausedTotalSeconds { get; set; }
}

public class TicketSlaEvent
{
    public Guid Id { get; set; }
    public Guid TicketId { get; set; }
    public string Clock { get; set; } = "";
    public string Event { get; set; } = "";
    public int CycleNo { get; set; } = 1;
    public DateTimeOffset CreatedAt { get; set; }
}
