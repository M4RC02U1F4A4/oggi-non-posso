package hub

import (
	"runtime"
	"sync"
	"testing"
	"time"
)

func receive(t *testing.T, ch <-chan Update) Update {
	t.Helper()
	select {
	case u := <-ch:
		return u
	case <-time.After(2 * time.Second):
		t.Fatal("no update arrived")
		return Update{}
	}
}

func wantNothing(t *testing.T, ch <-chan Update) {
	t.Helper()
	select {
	case u := <-ch:
		t.Fatalf("an update arrived: %+v", u)
	case <-time.After(20 * time.Millisecond):
	}
}

func TestSubscribersReceive(t *testing.T) {
	h := New()
	first, cancelFirst := h.Subscribe("3f2b8c1e-9a47-4d0b-8e65-1c7a2f9d4b10")
	second, cancelSecond := h.Subscribe("3f2b8c1e-9a47-4d0b-8e65-1c7a2f9d4b10")
	other, cancelOther := h.Subscribe("anotherEvent")
	defer cancelSecond()
	defer cancelOther()

	by := "Zr4h1TqPwm"
	sent := Update{Version: 13, Kind: KindAbsences, By: &by}
	h.Publish("3f2b8c1e-9a47-4d0b-8e65-1c7a2f9d4b10", sent)

	for _, ch := range []<-chan Update{first, second} {
		if got := receive(t, ch); got != sent {
			t.Fatalf("received %+v, want %+v", got, sent)
		}
	}
	wantNothing(t, other)

	// A cancelled subscriber receives nothing more; the other still does.
	cancelFirst()
	cancelFirst() // cancelling twice is harmless
	h.Publish("3f2b8c1e-9a47-4d0b-8e65-1c7a2f9d4b10", Update{Version: 14, Kind: KindStatus})
	wantNothing(t, first)
	if got := receive(t, second); got.Version != 14 {
		t.Fatalf("received %+v, want version 14", got)
	}
}

func TestSlowSubscriberKeepsOnlyTheNewest(t *testing.T) {
	h := New()
	slow, cancel := h.Subscribe("3f2b8c1e-9a47-4d0b-8e65-1c7a2f9d4b10")
	defer cancel()

	done := make(chan struct{})
	go func() {
		defer close(done)
		for v := int64(1); v <= 100; v++ {
			h.Publish("3f2b8c1e-9a47-4d0b-8e65-1c7a2f9d4b10", Update{Version: v, Kind: KindAbsences})
		}
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Publish blocked on a subscriber that does not read")
	}

	if got := receive(t, slow); got.Version != 100 {
		t.Fatalf("received version %d, want the newest (100)", got.Version)
	}
	wantNothing(t, slow)
}

func TestNewestIsTheHighestVersion(t *testing.T) {
	// Two changes can be published in the opposite order of their versions.
	h := New()
	slow, cancel := h.Subscribe("3f2b8c1e-9a47-4d0b-8e65-1c7a2f9d4b10")
	defer cancel()

	h.Publish("3f2b8c1e-9a47-4d0b-8e65-1c7a2f9d4b10", Update{Version: 8, Kind: KindStatus})
	h.Publish("3f2b8c1e-9a47-4d0b-8e65-1c7a2f9d4b10", Update{Version: 7, Kind: KindAbsences})
	if got := receive(t, slow); got.Version != 8 || got.Kind != KindStatus {
		t.Fatalf("received %+v, want version 8", got)
	}
	wantNothing(t, slow)
}

func TestNothingIsLeftAfterCancel(t *testing.T) {
	h := New()
	before := runtime.NumGoroutine()

	var cancels []func()
	for range 10 {
		_, cancel := h.Subscribe("3f2b8c1e-9a47-4d0b-8e65-1c7a2f9d4b10")
		cancels = append(cancels, cancel)
		_, cancel = h.Subscribe("anotherEvent")
		cancels = append(cancels, cancel)
	}
	h.Publish("3f2b8c1e-9a47-4d0b-8e65-1c7a2f9d4b10", Update{Version: 2, Kind: KindStatus})
	if got := len(h.subscribers); got != 2 {
		t.Fatalf("%d events have subscribers, want 2", got)
	}
	for _, cancel := range cancels {
		cancel()
	}

	if got := len(h.subscribers); got != 0 {
		t.Fatalf("%d map entries left after cancel", got)
	}
	if after := runtime.NumGoroutine(); after != before {
		t.Fatalf("goroutines: %d before, %d after", before, after)
	}
	// Publishing to an event nobody watches is fine and leaves no entry.
	h.Publish("3f2b8c1e-9a47-4d0b-8e65-1c7a2f9d4b10", Update{Version: 3, Kind: KindStatus})
	if got := len(h.subscribers); got != 0 {
		t.Fatalf("Publish left %d map entries", got)
	}
}

func TestConcurrentUse(t *testing.T) {
	h := New()
	var wg sync.WaitGroup
	for i := range 8 {
		wg.Add(2)
		go func() {
			defer wg.Done()
			for v := int64(1); v <= 200; v++ {
				h.Publish("3f2b8c1e-9a47-4d0b-8e65-1c7a2f9d4b10", Update{Version: v, Kind: KindAbsences})
			}
		}()
		go func() {
			defer wg.Done()
			for range 50 {
				ch, cancel := h.Subscribe("3f2b8c1e-9a47-4d0b-8e65-1c7a2f9d4b10")
				if i%2 == 0 {
					select {
					case <-ch:
					default:
					}
				}
				cancel()
			}
		}()
	}
	wg.Wait()
	if got := len(h.subscribers); got != 0 {
		t.Fatalf("%d map entries left", got)
	}
}
