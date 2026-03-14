'use client';

import type { CSSProperties } from 'react';

type AnimatedContourBackgroundProps = {
  className?: string;
  lineColor?: string;
  lineOpacity?: number;
  glowOpacity?: number;
  speedSeconds?: number;
  blurPx?: number;
  intensity?: number;
  centerFade?: number;
};

const CONTOUR_PATHS = [
  'M-58 118C28 31 152 20 230 74C310 128 424 118 503 69C588 16 686 19 754 92C828 173 949 179 1035 110C1112 48 1238 40 1326 106C1401 163 1511 160 1593 108C1669 59 1761 59 1836 103',
  'M-40 176C44 102 149 98 231 135C312 171 418 160 503 121C588 81 674 84 734 140C796 198 891 206 961 170C1036 132 1125 127 1193 170C1264 216 1370 221 1452 182C1536 142 1659 148 1756 216',
  'M-112 286C-21 206 107 196 206 250C302 302 445 302 551 236C651 175 766 177 848 244C929 311 1043 310 1141 251C1244 188 1367 192 1461 264C1549 332 1686 340 1785 279',
  'M-92 406C4 338 119 350 216 408C317 469 457 479 559 416C648 361 758 360 843 417C934 478 1064 489 1167 435C1269 382 1383 393 1473 448C1566 503 1703 512 1812 457',
  'M-54 542C55 486 161 503 246 566C338 633 470 651 577 606C684 561 792 567 872 628C952 691 1078 705 1182 661C1285 617 1411 623 1504 676C1607 735 1749 735 1840 678',
  'M-86 716C1 640 121 635 224 684C324 731 470 723 575 672C683 619 797 622 886 680C976 739 1098 744 1198 698C1299 652 1417 661 1516 721C1608 777 1727 786 1816 737',
  'M118 78C204 44 316 76 350 157C383 235 333 322 250 349C165 377 77 329 53 247C29 163 46 106 118 78Z',
  'M147 118C213 94 292 118 317 181C343 246 306 309 242 331C177 352 109 323 84 262C59 200 82 143 147 118Z',
  'M204 160C250 147 296 172 309 220C322 271 294 320 245 334C197 348 149 322 131 279C113 236 150 176 204 160Z',
  'M664 24C727 7 792 35 813 94C835 156 799 219 738 235C676 252 611 221 586 162C562 104 602 41 664 24Z',
  'M699 60C749 48 796 70 811 116C826 165 798 214 751 228C704 242 655 216 638 173C620 128 647 74 699 60Z',
  'M1215 56C1286 28 1378 43 1428 108C1477 173 1466 262 1404 310C1338 360 1240 355 1189 289C1139 226 1146 110 1215 56Z',
  'M1260 108C1311 89 1371 99 1403 145C1437 192 1432 255 1387 288C1341 322 1278 318 1240 276C1202 234 1210 130 1260 108Z',
  'M1332 392C1395 364 1471 386 1502 447C1533 508 1506 587 1441 616C1376 645 1299 620 1268 560C1237 498 1268 421 1332 392Z',
  'M1381 434C1425 416 1472 430 1492 472C1511 514 1492 568 1446 586C1399 605 1344 587 1324 544C1304 499 1337 452 1381 434Z',
  'M797 282C860 251 930 270 957 331C982 390 956 467 891 495C826 523 750 496 724 435C699 375 734 313 797 282Z',
  'M835 329C877 311 922 323 938 364C953 405 936 454 892 471C847 488 797 471 781 429C765 386 792 347 835 329Z',
  'M751 402C777 392 806 400 815 425C825 451 814 482 787 492C760 501 730 490 720 463C710 436 725 412 751 402Z',
  'M257 560C344 533 433 564 465 642C497 721 452 807 372 833C290 860 201 818 170 736C139 654 180 586 257 560Z',
  'M304 603C363 587 420 609 441 663C461 718 430 778 372 796C314 813 255 785 234 729C212 673 246 619 304 603Z',
  'M347 646C384 639 417 654 429 688C440 723 422 761 385 771C347 782 309 765 296 728C283 691 309 653 347 646Z',
  'M1087 533C1142 497 1224 507 1271 557C1319 609 1319 692 1270 742C1220 792 1135 802 1078 760C1022 718 1003 627 1041 573C1052 557 1068 545 1087 533Z',
  'M1128 575C1168 551 1223 557 1252 594C1281 632 1280 690 1248 725C1215 760 1157 767 1118 741C1079 715 1065 654 1088 612C1096 598 1110 585 1128 575Z',
  'M954 454C1015 430 1084 445 1120 500C1156 555 1147 628 1094 664C1040 700 963 695 915 653C867 610 857 540 892 491C907 471 928 463 954 454Z',
  'M988 492C1030 476 1077 486 1102 523C1127 560 1122 610 1086 636C1049 662 996 658 963 630C930 601 923 553 946 519C956 505 970 498 988 492Z',
  'M1022 529C1048 520 1077 525 1092 547C1108 569 1105 598 1084 613C1061 629 1028 627 1008 610C988 592 984 563 998 542C1005 533 1012 531 1022 529Z',
  'M872 566C915 548 970 559 1001 597C1033 635 1032 694 997 731C962 768 906 776 862 750C818 724 796 669 811 622C820 594 842 577 872 566Z',
  'M893 605C923 593 959 600 980 625C1001 650 1000 689 977 714C953 740 916 745 887 730C858 715 844 680 854 647C860 628 873 613 893 605Z',
  'M663 483C721 456 792 470 832 521C873 572 871 652 825 701C779 750 705 762 649 733C591 704 560 634 577 571C588 528 620 503 663 483Z',
  'M697 528C736 510 783 519 811 553C839 587 838 639 807 671C775 704 726 712 688 693C649 674 628 627 638 585C645 559 665 543 697 528Z',
  'M734 569C758 558 786 563 803 584C820 605 819 635 800 655C780 675 750 681 726 669C702 657 688 628 694 602C699 586 713 578 734 569Z',
  'M1499 665C1564 634 1649 643 1698 696C1747 748 1750 828 1704 880C1656 933 1571 940 1512 904C1453 868 1424 793 1448 728C1457 704 1474 684 1499 665Z',
  'M1543 709C1589 688 1644 693 1675 729C1707 766 1708 820 1678 856C1648 892 1592 900 1547 878C1502 856 1478 806 1491 761C1498 737 1517 721 1543 709Z',
  'M1519 779C1544 768 1572 772 1588 791C1604 810 1605 840 1589 860C1572 879 1541 884 1517 872C1493 860 1480 832 1488 805C1492 792 1503 784 1519 779Z',
  'M164 493C186 482 214 486 226 507C237 527 231 554 211 564C191 575 164 570 150 549C136 528 142 504 164 493Z',
  'M97 573C111 566 128 569 135 582C142 595 138 611 125 618C112 625 95 622 87 608C79 595 84 580 97 573Z',
  'M-22 791C2 780 30 785 41 808C52 831 46 860 23 872C0 884-30 877-42 853C-54 829-46 801-22 791Z',
];

function getContourPathStyle(index: number): CSSProperties {
  const duration = 17 + (index % 7) * 3.1;
  const delay = -((index % 11) * 1.7);
  const shiftX = ((index % 5) - 2) * 0.35;
  const shiftY = ((index % 6) - 2.5) * 0.28;
  const rotate = ((index % 7) - 3) * 0.08;

  return {
    '--contour-path-duration': `${duration}s`,
    '--contour-path-delay': `${delay}s`,
    '--contour-path-shift-x': `${shiftX}%`,
    '--contour-path-shift-y': `${shiftY}%`,
    '--contour-path-rotate': `${rotate}deg`,
  } as CSSProperties;
}

export function AnimatedContourBackground({
  className,
  lineColor = '#13d79c',
  lineOpacity = 0.22,
  glowOpacity = 0.16,
  speedSeconds = 64,
  blurPx = 10,
  intensity = 1,
  centerFade = 0.52,
}: AnimatedContourBackgroundProps) {
  const style = {
    '--contour-line-color': lineColor,
    '--contour-line-opacity': `${lineOpacity}`,
    '--contour-glow-opacity': `${glowOpacity}`,
    '--contour-speed': `${speedSeconds}s`,
    '--contour-blur': `${blurPx}px`,
    '--contour-intensity': `${intensity}`,
    '--contour-center-fade': `${centerFade}`,
  } as CSSProperties;

  return (
    <div
      aria-hidden="true"
      className={`animated-contour-background${className ? ` ${className}` : ''}`}
      style={style}
    >
      <div className="animated-contour-background__wash" />
      <div className="animated-contour-background__center-veil" />
      <svg
        className="animated-contour-background__svg animated-contour-background__svg--glow"
        viewBox="0 0 1600 900"
        preserveAspectRatio="xMidYMid slice"
      >
        <g className="animated-contour-background__layer animated-contour-background__layer--a">
          {CONTOUR_PATHS.map((path, index) => (
            <path key={`glow-a-${index}`} d={path} className="animated-contour-background__path" style={getContourPathStyle(index)} />
          ))}
        </g>
        <g className="animated-contour-background__layer animated-contour-background__layer--b">
          {CONTOUR_PATHS.map((path, index) => (
            <path key={`glow-b-${index}`} d={path} className="animated-contour-background__path" style={getContourPathStyle(index + 13)} />
          ))}
        </g>
      </svg>
      <svg
        className="animated-contour-background__svg animated-contour-background__svg--line"
        viewBox="0 0 1600 900"
        preserveAspectRatio="xMidYMid slice"
      >
        <g className="animated-contour-background__layer animated-contour-background__layer--a">
          {CONTOUR_PATHS.map((path, index) => (
            <path key={`line-a-${index}`} d={path} className="animated-contour-background__path" style={getContourPathStyle(index + 5)} />
          ))}
        </g>
        <g className="animated-contour-background__layer animated-contour-background__layer--b">
          {CONTOUR_PATHS.map((path, index) => (
            <path key={`line-b-${index}`} d={path} className="animated-contour-background__path" style={getContourPathStyle(index + 19)} />
          ))}
        </g>
      </svg>
    </div>
  );
}
