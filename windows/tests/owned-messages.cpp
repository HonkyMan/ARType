#include "OwnedMessages.h"
#include <cassert>
#include <iostream>
struct Payload {
    int& live;
    explicit Payload(int& value) : live(value) { ++live; }
    ~Payload() { --live; }
};
int main() {
    int live = 0;
    OwnedMessages<Payload> messages;
    const auto first = messages.put(std::make_unique<Payload>(live));
    assert(first && live == 1);
    auto consumed = messages.take(first);
    assert(consumed && !messages.take(first));
    consumed.reset();
    const auto dropped = messages.put(std::make_unique<Payload>(live));
    messages.clear(); // Closing the destination releases an undelivered message.
    assert(live == 0 && !messages.take(dropped));
    for (int i = 0; i < 256; ++i) assert(messages.put(std::make_unique<Payload>(live)));
    assert(!messages.put(std::make_unique<Payload>(live)));
    assert(live == 256);
    messages.clear();
    assert(live == 0);
    std::cout << "owned message payloads: passed\n";
}
