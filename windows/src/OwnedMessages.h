#pragma once
#include <cstdint>
#include <memory>
#include <mutex>
#include <unordered_map>

template<class T>
class OwnedMessages {
public:
    uintptr_t put(std::unique_ptr<T> message) {
        std::lock_guard lock(mutex_);
        if (messages_.size() >= 256) return 0;
        do { ++next_; } while (!next_ || messages_.contains(next_));
        messages_.emplace(next_, std::move(message));
        return next_;
    }
    std::unique_ptr<T> take(uintptr_t id) {
        std::lock_guard lock(mutex_);
        auto entry = messages_.find(id);
        if (entry == messages_.end()) return {};
        auto message = std::move(entry->second);
        messages_.erase(entry);
        return message;
    }
    void clear() {
        std::lock_guard lock(mutex_);
        messages_.clear();
    }
private:
    std::mutex mutex_;
    uintptr_t next_ = 0;
    std::unordered_map<uintptr_t, std::unique_ptr<T>> messages_;
};
