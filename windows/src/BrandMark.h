#pragma once
#include <windows.h>
#include <algorithm>

namespace brand {

/// 单色 ARType 标记：点阵汇聚成潮头。适用于托盘外的小尺寸 GDI 界面。
inline void DrawMark(HDC dc, RECT bounds, COLORREF color) {
    const int width = std::max<LONG>(1, bounds.right - bounds.left);
    const int height = std::max<LONG>(1, bounds.bottom - bounds.top);
    auto x = [&](int value) { return bounds.left + MulDiv(value, width, 64); };
    auto y = [&](int value) { return bounds.top + MulDiv(value, height, 64); };

    HBRUSH brush = CreateSolidBrush(color);
    HGDIOBJ oldBrush = SelectObject(dc, brush);
    HGDIOBJ oldPen = SelectObject(dc, GetStockObject(NULL_PEN));
    // Shift A: shared A-to-arrow silhouette, simplified for small native surfaces.
    POINT outline[]={{x(4),y(55)},{x(26),y(9)},{x(38),y(9)},
        {x(49),y(33)},{x(39),y(33)},{x(32),y(19)},{x(15),y(55)}};
    Polygon(dc,outline,7);
    POINT arrow[]={{x(21),y(34)},{x(50),y(34)},{x(50),y(27)},
        {x(63),y(39)},{x(55),y(47)},{x(60),y(55)},{x(47),y(55)},
        {x(41),y(43)},{x(17),y(43)}};
    Polygon(dc,arrow,9);

    SelectObject(dc, oldPen);
    SelectObject(dc, oldBrush);
    DeleteObject(brush);
}

} // namespace brand
