// Package hub carries the live updates of events from the handlers that
// change them to the streams that watch them.
package hub

// The kinds of update.
const (
	KindAbsences     = "absences"
	KindParticipants = "participants"
	KindStatus       = "status"
)

// Update tells a watcher that an event changed. It carries no data: the
// watcher fetches the event again when Version is newer than what it holds.
type Update struct {
	Version int64  `json:"version"`
	Kind    string `json:"kind"` // "absences" | "participants" | "status"
	// By is the id of the participant who caused the change, or nil.
	By *string `json:"by"`
}
